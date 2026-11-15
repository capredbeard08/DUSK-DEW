/** Shared test harness: real Worker routes over an in-memory D1-compatible database. */
import { createD1 } from '../scripts/d1-shim.mjs';
import worker from '../src/index.js';
import { ensureReady } from '../src/lib/bootstrap.js';

export const ORIGIN = 'http://localhost:3000';

export async function createEnv(overrides = {}) {
  const db = createD1(':memory:');
  const env = {
    DB: db,
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) },
    APP_ORIGIN: ORIGIN,
    FOUNDER_EMAIL: 'founder@duskanddew.com',
    FOUNDER_PASSWORD: 'DuskAndDew!2026',
    ...overrides,
  };
  await ensureReady(env);
  return env;
}

function cookieJarFrom(response, jar) {
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const cookie of cookies) {
    const [pair] = cookie.split(';');
    const [name, ...rest] = pair.split('=');
    jar[name.trim()] = rest.join('=');
  }
  return jar;
}

export async function request(env, path, { method = 'GET', form = null, headers = {}, jar = {}, json = null, raw = null } = {}) {
  const h = new Headers({ origin: ORIGIN, ...headers });
  let body;
  if (form) {
    body = new URLSearchParams(form).toString();
    h.set('content-type', 'application/x-www-form-urlencoded');
  } else if (json) {
    body = JSON.stringify(json);
    h.set('content-type', 'application/json');
  } else if (raw !== null) {
    body = raw;
  }
  if (Object.keys(jar).length) {
    h.set('cookie', Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '));
  }
  const response = await worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers: h, body }), env, { waitUntil() {} });
  cookieJarFrom(response, jar);
  const text = await response.text();
  return { response, status: response.status, text, headers: response.headers, jar };
}

export async function getCsrf(env, path = '/', jar = {}) {
  const res = await request(env, path, { jar });
  const match = res.text.match(/name="_csrf" value="([^"]+)"/);
  return { token: match ? match[1] : jar.dd_csrf, jar: res.jar, html: res.text, status: res.status };
}

const NEW_FOUNDER_PASSWORD = 'DuskAndDew!2026-secure';

export async function loginFounder(env, { password = null, email = 'founder@duskanddew.com', changePassword = true } = {}) {
  let attemptPassword = password || env.__founderPassword || 'DuskAndDew!2026';
  let res;
  let page;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    page = await request(env, '/admin/login', {});
    const token = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
    res = await request(env, '/admin/login', {
      method: 'POST',
      jar: page.jar,
      form: { email, password: attemptPassword, _csrf: token },
    });
    if (res.status === 303) break;
    if (attempt === 0 && !password && !env.__founderPassword) {
      attemptPassword = NEW_FOUNDER_PASSWORD;
      continue;
    }
  }
  let jarAfter = res.jar;
  let location = res.headers.get('location');
  let nextPassword = attemptPassword;
  if (changePassword && location === '/account/password') {
    const changePage = await request(env, '/account/password', { jar: jarAfter });
    const csrf = changePage.text.match(/name="_csrf" value="([^"]+)"/)[1];
    const changed = await request(env, '/account/password', {
      method: 'POST',
      jar: changePage.jar,
      form: { _csrf: csrf, current: attemptPassword, password: NEW_FOUNDER_PASSWORD, confirm: NEW_FOUNDER_PASSWORD },
    });
    jarAfter = changed.jar;
    nextPassword = NEW_FOUNDER_PASSWORD;
    location = '/admin';
  }
  env.__founderPassword = nextPassword;
  return { jar: jarAfter, status: res.status, location, password: nextPassword, email };
}

export async function sessionCsrf(env, path, jar) {
  const page = await request(env, path, { jar });
  const match = page.text.match(/name="_csrf" value="([^"]+)"/);
  return { csrf: match ? match[1] : '', html: page.text, jar: page.jar, status: page.status };
}

export async function payOrder(env, order, { eventId = null, amount = null, event = 'charge.success', status = 'success', signature = null } = {}) {
  const payload = JSON.stringify({
    event,
    data: {
      id: eventId || Math.floor(Math.random() * 1e12),
      reference: order.payment_reference,
      status,
      amount: amount === null ? order.total_cents : amount,
      gateway_response: status === 'success' ? 'Successful' : 'Declined',
    },
  });
  const headers = {};
  const sig = signature === null ? await signWebhook(payload) : signature;
  if (sig) headers['x-paystack-signature'] = sig;
  return request(env, '/webhooks/paystack', { method: 'POST', raw: payload, headers });
}

export async function createProduct(env, overrides = {}) {
  const id = `prd_${Math.random().toString(36).slice(2, 12)}`;
  const now = new Date().toISOString();
  const product = {
    id,
    slug: overrides.slug || `test-product-${id}`,
    sku: overrides.sku || `SKU-${id.slice(-6).toUpperCase()}`,
    name: overrides.name || 'Test Serum',
    price_cents: overrides.price_cents ?? 4800,
    status: overrides.status || 'active',
    fulfilment_model: overrides.fulfilment_model || 'inventory',
    preorder_enabled: overrides.preorder_enabled ?? 0,
    low_stock_threshold: overrides.low_stock_threshold ?? 10,
    currency: 'USD',
    ...overrides,
  };
  await env.DB.prepare(
    `INSERT INTO products (id, slug, sku, name, price_cents, currency, status, fulfilment_model, preorder_enabled,
      low_stock_threshold, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(product.id, product.slug, product.sku, product.name, product.price_cents, product.status, product.fulfilment_model, product.preorder_enabled, product.low_stock_threshold, now, now)
    .run();
  await env.DB.prepare('INSERT INTO inventory (product_id, physical_stock, reserved_stock, units_sold, updated_at) VALUES (?, ?, 0, 0, ?)')
    .bind(id, overrides.stock ?? 0, now)
    .run();
  return product;
}

export async function stockOf(env, productId) {
  const row = await env.DB.prepare('SELECT physical_stock, reserved_stock, units_sold FROM inventory WHERE product_id = ?').bind(productId).first();
  return { physical: Number(row.physical_stock), reserved: Number(row.reserved_stock), sold: Number(row.units_sold) };
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(key, String(value), new Date().toISOString())
    .run();
}

export const WEBHOOK_SECRET = 'sk_test_dusk_and_dew_webhook_secret';

/** Environment with payments enabled through the offline sandbox provider (no network). */
export async function commerceEnv(overrides = {}) {
  const env = await createEnv({ PAYSTACK_SECRET_KEY: WEBHOOK_SECRET, PAYMENTS_OFFLINE: '1', ...overrides });
  await setSetting(env, 'payments_enabled', '1');
  await setSetting(env, 'store_mode', 'live');
  await setSetting(env, 'payment_provider', 'offline');
  await setSetting(env, 'payment_providers', 'paystack,paypal');
  await setSetting(env, 'preorders_enabled', '0');
  await env.DB.prepare("UPDATE supported_countries SET enabled = 1, shipping_cents = 1500 WHERE code = 'NG'").run();
  return env;
}

export async function createBatch(env, product, allocated = 10, overrides = {}) {
  const now = new Date().toISOString();
  const batchId = `bat_${Math.random().toString(36).slice(2, 10)}`;
  await env.DB.prepare(
    `INSERT INTO production_batches (id, reference, manufacturer, status, estimated_completion, created_at, updated_at)
     VALUES (?, ?, 'Test Manufacturer', ?, ?, ?, ?)`,
  )
    .bind(batchId, overrides.reference || `BATCH-T-${batchId.slice(-6).toUpperCase()}`, overrides.status || 'planned', overrides.estimated_completion || null, now, now)
    .run();
  const itemId = `bit_${Math.random().toString(36).slice(2, 10)}`;
  await env.DB.prepare(
    `INSERT INTO batch_items (id, batch_id, product_id, allocated_qty, preorder_qty, preorder_holds, received_qty, unit_cost_cents)
     VALUES (?, ?, ?, ?, 0, 0, 0, 1000)`,
  )
    .bind(itemId, batchId, product.id, allocated)
    .run();
  return { batchId, itemId, reference: overrides.reference || '' };
}

export async function signWebhook(payload, secret = WEBHOOK_SECRET) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Full checkout through the public route, returning the created order. */
export async function placeOrder(env, { product, qty = 1, email = 'buyer@example.com', name = 'Test Buyer', country = 'NG' } = {}) {
  const page = await request(env, '/checkout');
  const token = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const res = await request(env, '/checkout', {
    method: 'POST',
    jar: page.jar,
    form: {
      _csrf: token,
      name,
      email,
      country,
      line1: '1 Test Street',
      city: 'Lagos',
      postcode: '100001',
      phone: '000',
      terms: 'on',
      items: JSON.stringify([{ id: product.id, qty }]),
    },
  });
  const location = res.headers.get('location') || '';
  const reference = location.startsWith('/pay/') ? decodeURIComponent(location.slice(5)) : null;
  let order = null;
  if (reference) {
    const payment = await env.DB.prepare('SELECT * FROM payments WHERE reference = ?').bind(reference).first();
    if (payment) order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(payment.order_id).first();
  }
  if (!order) {
    order = await env.DB.prepare('SELECT * FROM orders WHERE email = ? ORDER BY placed_at DESC LIMIT 1').bind(email).first();
  }
  return { res, order, jar: res.jar, location, reference };
}
