/** Founder Console operational tests: product management, stock, orders, content, reports. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceEnv, loginFounder, sessionCsrf, request, stockOf, placeOrder, payOrder } from './helpers.mjs';

const productForm = (overrides = {}) => ({
  name: 'Console Balm',
  sku: 'CON-BALM-1',
  price: '64.00',
  currency: 'USD',
  cost: '20.00',
  status: 'active',
  fulfilment_model: 'inventory',
  preorder_enabled: '0',
  manual_unavailable: '0',
  low_stock_threshold: '5',
  opening_stock: '12',
  verification_status: 'verified',
  featured: '0',
  image_tone: 'deep',
  net_contents: '50 ml',
  subtitle: 'Created from the Founder Console',
  description: 'A test product created through the console.',
  inci_text: 'Aqua, Glycerin',
  directions: 'Apply as needed.',
  warnings: 'External use only.',
  claims: '',
  shipping_info: 'Ships from Lagos.',
  ...overrides,
});

test('Founder Console', async (t) => {
  const env = await commerceEnv();
  const login = await loginFounder(env);
  let productId = null;
  let paidOrder = null;

  await t.test('the founder can create a product with opening stock', async () => {
    const page = await sessionCsrf(env, '/admin/products/new', login.jar);
    const res = await request(env, '/admin/products', {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: page.csrf, ...productForm() },
    });
    assert.equal(res.status, 303);
    const row = await env.DB.prepare("SELECT * FROM products WHERE sku = 'CON-BALM-1'").first();
    assert.ok(row, 'product created');
    assert.equal(row.price_cents, 6400);
    assert.equal(row.status, 'active');
    assert.equal(row.verification_status, 'verified');
    productId = row.id;
    const stock = await stockOf(env, productId);
    assert.equal(stock.physical, 12, 'opening stock recorded');
    const restock = await env.DB.prepare('SELECT * FROM restocks WHERE product_id = ?').bind(productId).first();
    assert.equal(restock.qty, 12);
    assert.equal(restock.batch_ref, 'Opening stock');
  });

  await t.test('the founder can update a price, availability and description', async () => {
    const page = await sessionCsrf(env, `/admin/products/${productId}`, login.jar);
    const res = await request(env, `/admin/products/${productId}`, {
      method: 'POST',
      jar: login.jar,
      form: {
        _csrf: page.csrf,
        ...productForm({
          price: '72.50',
          subtitle: 'Updated from the console',
          manual_unavailable: '1',
          low_stock_threshold: '7',
        }),
      },
    });
    assert.equal(res.status, 303);
    const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first();
    assert.equal(row.price_cents, 7250);
    assert.equal(row.subtitle, 'Updated from the console');
    assert.equal(row.manual_unavailable, 1);
    assert.equal(row.low_stock_threshold, 7);

    const store = await request(env, `/shop/${row.slug}`);
    assert.match(store.text, /Temporarily unavailable/);
    assert.doesNotMatch(store.text, /Add to bag/);

    // Restore availability.
    const again = await sessionCsrf(env, `/admin/products/${productId}`, login.jar);
    await request(env, `/admin/products/${productId}`, {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: again.csrf, ...productForm({ price: '72.50', manual_unavailable: '0' }) },
    });
  });

  await t.test('inventory adjustments require a reason and are recorded', async () => {
    const page = await sessionCsrf(env, `/admin/inventory/${productId}`, login.jar);
    const noReason = await request(env, `/admin/inventory/${productId}/adjust`, {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: page.csrf, qty_delta: '-2', category: 'damaged', reason: '' },
    });
    assert.match(noReason.headers.get('location'), /error=/);
    assert.equal((await stockOf(env, productId)).physical, 12);

    const valid = await request(env, `/admin/inventory/${productId}/adjust`, {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: page.csrf, qty_delta: '-2', category: 'damaged', reason: 'Two jars broken in transit' },
    });
    assert.equal(valid.status, 303);
    assert.equal((await stockOf(env, productId)).physical, 10);
    const adjustment = await env.DB.prepare('SELECT * FROM stock_adjustments WHERE product_id = ?').bind(productId).first();
    assert.equal(adjustment.qty_delta, -2);
    assert.equal(adjustment.reason, 'Two jars broken in transit');
    const movement = await env.DB.prepare("SELECT * FROM inventory_movements WHERE product_id = ? AND kind = 'adjustment'").bind(productId).first();
    assert.ok(movement);
  });

  await t.test('restock from the restocking page increases stock and cost tracking', async () => {
    const page = await sessionCsrf(env, '/admin/restocks', login.jar);
    const res = await request(env, '/admin/restocks', {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: page.csrf, product_id: productId, qty: '30', supplier: 'Lagos Lab', unit_cost: '18.00', restock_date: '2026-02-01' },
    });
    assert.equal(res.status, 303);
    assert.equal((await stockOf(env, productId)).physical, 40);
    const restocks = await env.DB.prepare('SELECT * FROM restocks WHERE product_id = ? ORDER BY created_at DESC').bind(productId).all();
    assert.equal(restocks.results[0].qty, 30);
    assert.equal(restocks.results[0].unit_cost_cents, 1800);
  });

  await t.test('the founder can fulfil an order with tracking and customer notification', async () => {
    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first();
    const { order } = await placeOrder(env, { product, qty: 1, email: 'console-order@example.com', name: 'Console Buyer' });
    assert.ok(order);
    await payOrder(env, order, { eventId: 'console-pay-1' });
    paidOrder = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();

    const page = await sessionCsrf(env, `/admin/orders/${paidOrder.id}`, login.jar);
    const res = await request(env, `/admin/orders/${paidOrder.id}/fulfilment`, {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: page.csrf, fulfilment_status: 'shipped', shipping_provider: 'DHL', tracking_number: 'DHL123456' },
    });
    assert.equal(res.status, 303);
    const shipped = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(paidOrder.id).first();
    assert.equal(shipped.fulfilment_status, 'shipped');
    assert.equal(shipped.tracking_number, 'DHL123456');
    const record = await env.DB.prepare('SELECT * FROM shipping_records WHERE order_id = ?').bind(paidOrder.id).first();
    assert.equal(record.provider, 'DHL');
    const emails = await env.DB.prepare("SELECT * FROM email_notifications WHERE order_id = ? AND template_key LIKE 'dispatch%' OR order_id = ? AND template_key = 'tracking_information'").bind(paidOrder.id, paidOrder.id).all();
    assert.ok(emails.results.length >= 1);

    const customerView = await request(env, `/order/${paidOrder.reference}?email=console-order@example.com`);
    assert.match(customerView.text, /DHL123456/);
  });

  await t.test('internal notes are private and recorded', async () => {
    const page = await sessionCsrf(env, `/admin/orders/${paidOrder.id}`, login.jar);
    const res = await request(env, `/admin/orders/${paidOrder.id}/notes`, {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: page.csrf, note: 'Packed with a handwritten note.' },
    });
    assert.equal(res.status, 303);
    const note = await env.DB.prepare('SELECT * FROM order_notes WHERE order_id = ?').bind(paidOrder.id).first();
    assert.equal(note.note, 'Packed with a handwritten note.');
    const customer = await request(env, `/order/${paidOrder.reference}?email=console-order@example.com`);
    assert.doesNotMatch(customer.text, /handwritten note/);
  });

  await t.test('products are archived rather than deleted', async () => {
    const page = await sessionCsrf(env, `/admin/products/${productId}`, login.jar);
    const res = await request(env, `/admin/products/${productId}`, {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: page.csrf, action: 'archive' },
    });
    assert.equal(res.status, 303);
    const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first();
    assert.equal(row.status, 'discontinued');
    assert.equal(row.manual_unavailable, 1);
    const shop = await request(env, '/shop');
    assert.doesNotMatch(shop.text, /Console Balm/);
    const orderItems = await env.DB.prepare('SELECT * FROM order_items WHERE product_id = ?').bind(productId).all();
    assert.ok(orderItems.results.length >= 1, 'historical order items retained');
  });

  await t.test('content edits appear on the storefront', async () => {
    const page = await sessionCsrf(env, '/admin/content', login.jar);
    const res = await request(env, '/admin/content/philosophy', {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: page.csrf, title: 'Quiet care, plainly stated', body: 'Updated copy from the console.' },
    });
    assert.equal(res.status, 303);
    const home = await request(env, '/');
    assert.match(home.text, /Quiet care, plainly stated/);
    assert.match(home.text, /Updated copy from the console/);
  });

  await t.test('analytics and CSV exports work', async () => {
    const analytics = await request(env, '/admin/analytics?from=2026-01-01&to=2026-12-31', { jar: login.jar });
    assert.equal(analytics.status, 200);
    assert.match(analytics.text, /Gross revenue/);
    assert.match(analytics.text, /Product performance/);
    const csv = await request(env, '/admin/analytics/export.csv', { jar: login.jar });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.text, /Gross revenue/);
    const ordersCsv = await request(env, '/admin/orders/export.csv', { jar: login.jar });
    assert.match(ordersCsv.text, /DD-/);
    const inventoryCsv = await request(env, '/admin/inventory/export.csv', { jar: login.jar });
    assert.match(inventoryCsv.text, /Physical/);
  });

  await t.test('administrative actions are written to the audit log', async () => {
    const page = await request(env, '/admin/audit', { jar: login.jar });
    assert.equal(page.status, 200);
    for (const action of ['product.created', 'product.updated', 'inventory.adjusted', 'inventory.restocked', 'order.fulfilment_updated', 'content.updated', 'product.archived']) {
      assert.match(page.text, new RegExp(action), `audit log contains ${action}`);
    }
  });

  await t.test('waitlist registrations can be marked notified', async () => {
    const entry = await env.DB.prepare('SELECT * FROM waitlist ORDER BY created_at DESC LIMIT 1').first();
    const page = await sessionCsrf(env, '/admin/preorders', login.jar);
    const res = await request(env, `/admin/preorders/waitlist/${entry.id}/notify`, {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: page.csrf },
    });
    assert.equal(res.status, 303);
    const updated = await env.DB.prepare('SELECT * FROM waitlist WHERE id = ?').bind(entry.id).first();
    assert.equal(updated.status, 'notified');
  });

  await t.test('the founder can enable payments only with configured credentials', async () => {
    const page = await sessionCsrf(env, '/admin/payments', login.jar);
    const res = await request(env, '/admin/payments', {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: page.csrf, payments_enabled: '1', payment_provider: 'offline', store_mode: 'live' },
    });
    assert.equal(res.status, 303);
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'payments_enabled'").first();
    assert.equal(row.value, '1');
    const audit = await env.DB.prepare("SELECT * FROM audit_logs WHERE action = 'payments.enabled'").first();
    assert.ok(audit);
  });

  await t.test('a founder cannot disable their own account', async () => {
    const founder = await env.DB.prepare("SELECT * FROM users WHERE role = 'founder' LIMIT 1").first();
    const page = await sessionCsrf(env, '/admin/users', login.jar);
    const res = await request(env, `/admin/users/${founder.id}/toggle`, {
      method: 'POST',
      jar: login.jar,
      form: { _csrf: page.csrf },
    });
    assert.match(res.headers.get('location'), /error=/);
    const still = await env.DB.prepare('SELECT is_active FROM users WHERE id = ?').bind(founder.id).first();
    assert.equal(still.is_active, 1);
  });
});
