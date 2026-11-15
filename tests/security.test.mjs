/** Security acceptance tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, commerceEnv, createProduct, loginFounder, sessionCsrf, request, stockOf, setSetting, createProduct as cp, payOrder, placeOrder } from './helpers.mjs';
import { hashPassword } from '../src/lib/security.js';

async function createUser(env, { email, password, role = 'customer', name = 'Test User' }) {
  const id = `usr_${Math.random().toString(36).slice(2, 10)}`;
  await env.DB.prepare(
    'INSERT INTO users (id, email, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
  )
    .bind(id, email, name, await hashPassword(password), role, new Date().toISOString())
    .run();
  return { id, email, password };
}

async function accountLogin(env, user) {
  const page = await request(env, '/account/login');
  const csrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const res = await request(env, '/account/login', {
    method: 'POST',
    jar: page.jar,
    form: { _csrf: csrf, email: user.email, password: user.password },
  });
  return { res, jar: res.jar };
}

test('Security', async (t) => {
  await t.test('unauthenticated access to the founder console is refused', async () => {
    const env = await createEnv();
    for (const path of ['/admin', '/admin/orders', '/admin/inventory', '/admin/payments', '/admin/users', '/admin/audit']) {
      const res = await request(env, path);
      assert.equal(res.status, 303, `${path} redirects`);
      assert.equal(res.headers.get('location'), '/admin/login');
    }
    const loginPage = await request(env, '/admin/login');
    assert.equal(loginPage.status, 200);
    assert.doesNotMatch(loginPage.text, /Paid revenue/);
  });

  await t.test('customer accounts cannot reach the console', async () => {
    const env = await createEnv();
    const user = await createUser(env, { email: 'customer@example.com', password: 'CustomerPass123' });
    const login = await accountLogin(env, user);
    assert.equal(login.res.status, 303);
    const res = await request(env, '/admin', { jar: login.jar });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/admin/login');
  });

  await t.test('unauthorised inventory changes are refused and stock is untouched', async () => {
    const env = await createEnv();
    const before = await stockOf(env, 'prd_serum');
    const res = await request(env, '/admin/inventory/prd_serum/restock', {
      method: 'POST',
      form: { qty: '1000', _csrf: 'anything' },
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/admin/login');
    const after = await stockOf(env, 'prd_serum');
    assert.equal(after.physical, before.physical);
  });

  await t.test('requests without a valid CSRF token are rejected', async () => {
    const env = await commerceEnv();
    const login = await loginFounder(env);
    const res = await request(env, '/admin/settings', {
      method: 'POST',
      jar: login.jar,
      form: { store_name: 'Hijacked', support_email: 'x@example.com' },
    });
    assert.equal(res.status, 403);
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'store_name'").first();
    assert.equal(row.value, 'DUSK & DEW');

    const restock = await request(env, '/admin/inventory/prd_serum/restock', {
      method: 'POST',
      jar: login.jar,
      form: { qty: '500' },
    });
    assert.equal(restock.status, 403);
  });

  await t.test('staff cannot issue refunds or manage payments', async () => {
    const env = await commerceEnv();
    const product = await createProduct(env, { name: 'Staff Test', sku: 'STAFF-1', stock: 5 });
    const { order } = await placeOrder(env, { product, email: 'stafforder@example.com' });
    await payOrder(env, order, { eventId: 'staff-refund-event' });
    const staff = await createUser(env, { email: 'staff@example.com', password: 'StaffPassword123', role: 'staff' });
    await accountLogin(env, staff);
    const loginPage = await request(env, '/admin/login');
    const csrf = loginPage.text.match(/name="_csrf" value="([^"]+)"/)[1];
    const login = await request(env, '/admin/login', {
      method: 'POST',
      jar: loginPage.jar,
      form: { _csrf: csrf, email: staff.email, password: staff.password },
    });
    assert.equal(login.status, 303);
    assert.equal(login.headers.get('location'), '/admin');

    const orderPage = await sessionCsrf(env, `/admin/orders/${order.id}`, login.jar);
    assert.equal(orderPage.status, 200);
    const refund = await request(env, `/admin/orders/${order.id}/refund`, {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: orderPage.csrf, amount: '10', reason: 'Nope' },
    });
    assert.equal(refund.status, 403);
    const payments = await request(env, '/admin/payments', { jar: login.jar });
    assert.equal(payments.status, 403);
    const users = await request(env, '/admin/users', { jar: login.jar });
    assert.equal(users.status, 403);
    void env;
  });

  await t.test('customer order data is private', async () => {
    const env = await createEnv();
    const publicView = await request(env, '/order/DD-0001');
    assert.equal(publicView.status, 200);
    assert.match(publicView.text, /Confirm your email/);
    assert.doesNotMatch(publicView.text, /sample\.customer@example\.com/);
    assert.doesNotMatch(publicView.text, /1 Example Street/);

    const page = await request(env, '/order/DD-0001');
    const csrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
    const wrong = await request(env, '/order/DD-0001/lookup', {
      method: 'POST',
      jar: page.jar,
      form: { _csrf: csrf, reference: 'DD-0001', email: 'attacker@example.com' },
    });
    assert.equal(wrong.status, 401);
    assert.match(wrong.text, /does not match/);
    assert.doesNotMatch(wrong.text, /1 Example Street/);

    const right = await request(env, '/order/DD-0001/lookup', {
      method: 'POST',
      jar: page.jar,
      form: { _csrf: csrf, reference: 'DD-0001', email: 'sample.customer@example.com' },
    });
    assert.equal(right.status, 303);
    const authed = await request(env, right.headers.get('location'));
    assert.equal(authed.status, 200);
    assert.match(authed.text, /DD-0001/);
    void env;
  });

  await t.test('secret credentials are never rendered', async () => {
    const env = await commerceEnv({ PAYSTACK_SECRET_KEY: 'sk_live_never_render_this_value' });
    const login = await loginFounder(env);
    for (const path of ['/', '/shop', '/checkout', '/admin', '/admin/payments', '/admin/settings']) {
      const res = await request(env, path, { jar: login.jar });
      assert.equal(res.status, 200, path);
      assert.doesNotMatch(res.text, /sk_live_never_render_this_value/, `${path} must not leak secrets`);
    }
  });

  await t.test('invalid form submissions are rejected without creating records', async () => {
    const env = await createEnv();
    const before = await env.DB.prepare('SELECT COUNT(*) AS c FROM products').first();
    const login = await loginFounder(env);
    const page = await sessionCsrf(env, '/admin/products/new', login.jar);
    const res = await request(env, '/admin/products', {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: page.csrf, name: 'Bad Product', sku: 'BAD-1', price: 'not-a-price' },
    });
    assert.match(res.headers.get('location'), /error=/);
    const after = await env.DB.prepare('SELECT COUNT(*) AS c FROM products').first();
    assert.equal(after.c, before.c);

    const waitlist = await request(env, '/waitlist', {
      method: 'POST',
      form: { name: 'No Email', email: 'not-an-email', _csrf: 'wrong' },
    });
    assert.equal(waitlist.status, 403);

    const csrf = await request(env, '/');
    const token = csrf.text.match(/name="_csrf" value="([^"]+)"/)[1];
    const invalidWaitlist = await request(env, '/waitlist', {
      method: 'POST',
      jar: csrf.jar,
      form: { name: 'No Email', email: 'not-an-email', _csrf: token },
    });
    assert.match(invalidWaitlist.headers.get('location'), /error=/);
    const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM waitlist WHERE email = 'not-an-email'").first();
    assert.equal(count.c, 0);
  });

  await t.test('signed-in visitors can use public forms (session CSRF accepted)', async () => {
    const env = await createEnv();
    const login = await loginFounder(env);
    const home = await request(env, '/', { jar: login.jar });
    const token = home.text.match(/name="_csrf" value="([^"]+)"/)[1];
    const res = await request(env, '/waitlist', {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: token, name: 'Signed In', email: 'signedin@example.com', country: 'NG' },
    });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /waitlist\/thanks/);
    const entry = await env.DB.prepare('SELECT * FROM waitlist WHERE email = ?').bind('signedin@example.com').first();
    assert.ok(entry, 'registration stored');
  });

  await t.test('login attempts are rate limited', async () => {
    const env = await createEnv();
    const page = await request(env, '/admin/login');
    const csrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
    let sawRateLimit = false;
    for (let i = 0; i < 10; i += 1) {
      const res = await request(env, '/admin/login', {
        method: 'POST',
        jar: page.jar,
        form: { _csrf: csrf, email: 'founder@duskanddew.com', password: `wrong-${i}` },
      });
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
      assert.equal(res.status, 401);
    }
    assert.ok(sawRateLimit, 'rate limit eventually blocks attempts');
    const audit = await env.DB.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'auth.console_rate_limited'").first();
    assert.ok(audit.c >= 1);
  });

  await t.test('passwords are PBKDF2-hashed and session tokens are stored hashed', async () => {
    const env = await createEnv();
    const login = await loginFounder(env);
    const user = await env.DB.prepare("SELECT * FROM users WHERE role = 'founder'").first();
    assert.match(user.password_hash, /^pbkdf2\$100000\$/);
    assert.doesNotMatch(user.password_hash, /DuskAndDew/);
    const session = await env.DB.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1').first();
    assert.match(session.id, /^[a-f0-9]{64}$/);
    assert.notEqual(session.id, login.jar.dd_session);
    assert.ok(session.csrf_token.length >= 24);
  });

  await t.test('SQL injection attempts are treated as literal text', async () => {
    const env = await createEnv();
    const res = await request(env, "/shop?q=%27%20OR%201%3D1--");
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, /SQLITE|syntax error/i);
    const cat = await request(env, "/shop?category=%27%20OR%20%271%27%3D%271");
    assert.equal(cat.status, 200);
    assert.match(cat.text, /The collection/);
  });

  await t.test('XSS payloads in content are escaped', async () => {
    const env = await createEnv();
    await env.DB.prepare("UPDATE site_content SET body = ? WHERE key = 'philosophy'")
      .bind('<script>alert("xss")</script>')
      .run();
    const res = await request(env, '/');
    assert.doesNotMatch(res.text, /<script>alert\("xss"\)<\/script>/);
    assert.match(res.text, /&lt;script&gt;/);
  });

  await t.test('payment settings cannot be enabled without verified credentials', async () => {
    const env = await createEnv();
    const login = await loginFounder(env);
    const page = await sessionCsrf(env, '/admin/payments', login.jar);
    const res = await request(env, '/admin/payments', {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: page.csrf, payments_enabled: '1', payment_provider: 'paystack', store_mode: 'live' },
    });
    assert.match(res.headers.get('location'), /error=/);
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'payments_enabled'").first();
    assert.equal(row.value, '0');
  });

  await t.test('checkout is unavailable while payments are disabled', async () => {
    const env = await createEnv();
    await setSetting(env, 'payments_enabled', '0');
    const product = await cp(env, { name: 'Waitlist Only', sku: 'WL-ONLY-1', stock: 10 });
    const { order, location } = await placeOrder(env, { product, qty: 1, email: 'wait@example.com' });
    assert.match(location, /waitlist\/thanks/);
    assert.equal(order, null, 'no order or payment is created in waitlist mode');
    const stock = await stockOf(env, product.id);
    assert.equal(stock.physical, 10);
    const entry = await env.DB.prepare('SELECT * FROM waitlist WHERE email = ?').bind('wait@example.com').first();
    assert.ok(entry);
  });
});
