/**
 * Inventory acceptance tests from the brief (Tests 1–10).
 * These run the real HTTP routes against an in-memory D1-compatible database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commerceEnv,
  createProduct,
  createBatch,
  placeOrder,
  payOrder,
  loginFounder,
  sessionCsrf,
  request,
  setSetting,
  stockOf,
} from './helpers.mjs';

const rows = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;

test('Inventory acceptance tests', async (t) => {
  const env = await commerceEnv();
  const product = await createProduct(env, { name: 'Acceptance Serum', sku: 'ACC-SER-001', stock: 100 });

  let state = await stockOf(env, product.id);
  assert.equal(state.physical, 100, 'starting stock is 100');

  let order2 = null;

  await t.test('Test 1 — purchase of 1 unit leaves 99', async () => {
    const { order, location } = await placeOrder(env, { product, qty: 1, email: 'one@example.com' });
    assert.ok(order, `checkout should create an order (redirected to ${location})`);
    assert.equal(order.subtotal_cents, 4800);
    assert.equal(order.shipping_cents, 1500);
    assert.equal(order.total_cents, 6300);
    state = await stockOf(env, product.id);
    assert.equal(state.reserved, 1, 'unpaid order reserves exactly one unit');

    const webhook = await payOrder(env, order, { eventId: 'evt-test-1' });
    assert.equal(webhook.status, 200);

    state = await stockOf(env, product.id);
    assert.equal(state.physical, 99);
    assert.equal(state.reserved, 0);
    assert.equal(state.sold, 1);

    const paid = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
    assert.equal(paid.payment_status, 'paid');
    assert.equal(paid.fulfilment_status, 'processing');

    const movements = await rows(env, "SELECT * FROM inventory_movements WHERE product_id = ? AND kind = 'sale'", product.id);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].qty_delta, -1);
  });

  await t.test('Test 2 — purchase of 3 units leaves 96', async () => {
    const { order } = await placeOrder(env, { product, qty: 3, email: 'two@example.com' });
    assert.ok(order);
    await payOrder(env, order, { eventId: 'evt-test-2' });
    state = await stockOf(env, product.id);
    assert.equal(state.physical, 96);
    assert.equal(state.sold, 4);
    order2 = order;
  });

  await t.test('Test 3 — failed payment leaves stock at 96 and releases the hold', async () => {
    const { order } = await placeOrder(env, { product, qty: 1, email: 'three@example.com' });
    assert.ok(order);
    assert.equal((await stockOf(env, product.id)).reserved, 1);
    const hook = await payOrder(env, order, { event: 'charge.failed', status: 'failed', eventId: 'evt-test-3' });
    assert.equal(hook.status, 200);
    state = await stockOf(env, product.id);
    assert.equal(state.physical, 96);
    assert.equal(state.reserved, 0, 'failed payment must release the reservation');
    const failed = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
    assert.equal(failed.payment_status, 'failed');
  });

  await t.test('Test 4 — duplicate successful webhook does not deduct twice', async () => {
    assert.ok(order2, 'previous order available');
    const replay = await payOrder(env, order2, { eventId: 'evt-test-2' });
    assert.equal(replay.status, 200);
    assert.equal(JSON.parse(replay.text).duplicate, true);
    state = await stockOf(env, product.id);
    assert.equal(state.physical, 96, 'stock unchanged after duplicate webhook');
    const sales = await rows(env, "SELECT * FROM inventory_movements WHERE product_id = ? AND kind = 'sale'", product.id);
    assert.equal(sales.length, 2, 'only two sale movements exist');
  });

  await t.test('Test 5 — restock of 50 raises stock to 146', async () => {
    const login = await loginFounder(env);
    const page = await sessionCsrf(env, `/admin/inventory/${product.id}`, login.jar);
    const res = await request(env, `/admin/inventory/${product.id}/restock`, {
      method: 'POST',
      jar: page.jar,
      form: { _csrf: page.csrf, qty: '50', supplier: 'Acceptance Lab', batch_ref: 'BATCH-R-1', unit_cost: '12.50', restock_date: '2026-01-15', notes: 'Restock test' },
    });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /notice=/);
    state = await stockOf(env, product.id);
    assert.equal(state.physical, 146);
    const restock = await env.DB.prepare('SELECT * FROM restocks WHERE product_id = ? ORDER BY created_at DESC LIMIT 1').bind(product.id).first();
    assert.equal(restock.qty, 50);
    assert.equal(restock.supplier, 'Acceptance Lab');
    assert.equal(restock.unit_cost_cents, 1250);
  });

  await t.test('Test 6 — purchase from available stock leaves 145 and availability is correct', async () => {
    const { order } = await placeOrder(env, { product, qty: 1, email: 'six@example.com' });
    await payOrder(env, order, { eventId: 'evt-test-6' });
    state = await stockOf(env, product.id);
    assert.equal(state.physical, 145);
    const row = await env.DB.prepare('SELECT status FROM products WHERE id = ?').bind(product.id).first();
    assert.equal(row.status, 'active');
  });

  await t.test('Test 6b — the final available unit sells out and availability flips', async () => {
    const last = await createProduct(env, { name: 'Final Unit Balm', sku: 'LAST-UNIT-1', stock: 1, low_stock_threshold: 0 });
    const { order } = await placeOrder(env, { product: last, qty: 1, email: 'last@example.com' });
    await payOrder(env, order, { eventId: 'evt-test-6b' });
    const stock = await stockOf(env, last.id);
    assert.equal(stock.physical, 0);
    const row = await env.DB.prepare('SELECT status FROM products WHERE id = ?').bind(last.id).first();
    assert.equal(row.status, 'out_of_stock');

    const page = await request(env, `/shop/${last.slug}`);
    assert.match(page.text, /Out of stock/i);

    // Restocking restores sale availability automatically.
    const login = await loginFounder(env);
    const inv = await sessionCsrf(env, `/admin/inventory/${last.id}`, login.jar);
    await request(env, `/admin/inventory/${last.id}/restock`, {
      method: 'POST',
      jar: inv.jar,
      form: { _csrf: inv.csrf, qty: '5', supplier: 'Top-up' },
    });
    const after = await env.DB.prepare('SELECT status FROM products WHERE id = ?').bind(last.id).first();
    assert.equal(after.status, 'active');

    // Manual unavailability overrides stock.
    await env.DB.prepare('UPDATE products SET manual_unavailable = 1 WHERE id = ?').bind(last.id).run();
    const manual = await request(env, `/shop/${last.slug}`);
    assert.match(manual.text, /Temporarily unavailable/i);
  });

  await t.test('Test 7 — attempting to buy more than available is blocked', async () => {
    const scarce = await createProduct(env, { name: 'Scarce Oil', sku: 'SCARCE-1', stock: 2 });
    const { res, location } = await placeOrder(env, { product: scarce, qty: 5, email: 'greedy@example.com' });
    assert.equal(res.status, 303);
    assert.match(location, /error=/);
    const stock = await stockOf(env, scarce.id);
    assert.equal(stock.physical, 2, 'no stock deducted');
    assert.equal(stock.reserved, 0, 'no reservation retained');
    const order = await env.DB.prepare('SELECT * FROM orders WHERE email = ?').bind('greedy@example.com').first();
    assert.equal(order.fulfilment_status, 'cancelled');
    assert.equal(order.payment_status, 'failed');
  });

  await t.test('Test 8 — two simultaneous buyers of the final unit: only one succeeds', async () => {
    const final = await createProduct(env, { name: 'One Only Serum', sku: 'ONE-ONLY-1', stock: 1 });
    const [a, b] = await Promise.all([
      placeOrder(env, { product: final, qty: 1, email: 'race-a@example.com' }),
      placeOrder(env, { product: final, qty: 1, email: 'race-b@example.com' }),
    ]);
    const orders = await rows(env, 'SELECT * FROM orders WHERE email IN (?, ?)', 'race-a@example.com', 'race-b@example.com');
    assert.equal(orders.length, 2, 'both attempts recorded');
    const winners = orders.filter((o) => o.fulfilment_status !== 'cancelled');
    assert.equal(winners.length, 1, 'exactly one order holds the unit');

    const stock = await stockOf(env, final.id);
    assert.equal(stock.reserved, 1);
    assert.equal(stock.physical, 1);

    const winner = winners[0];
    await payOrder(env, winner, { eventId: 'evt-race' });
    const settled = await stockOf(env, final.id);
    assert.equal(settled.physical, 0);
    assert.equal(settled.reserved, 0);
    const loser = orders.find((o) => o.id !== winner.id);
    const reservations = await rows(env, "SELECT * FROM inventory_reservations WHERE order_id = ? AND status = 'active'", loser.id);
    assert.equal(reservations.length, 0, 'loser holds no reservation');

    const page = await request(env, `/shop/${final.slug}`);
    assert.match(page.text, /Out of stock/i);
    void a;
    void b;
  });

  await t.test('Test 9 — expired reservations release stock automatically', async () => {
    const timed = await createProduct(env, { name: 'Timed Serum', sku: 'TIMED-1', stock: 5 });
    const { order } = await placeOrder(env, { product: timed, qty: 2, email: 'expire@example.com' });
    assert.ok(order);
    assert.equal((await stockOf(env, timed.id)).reserved, 2);

    await env.DB.prepare('UPDATE inventory_reservations SET expires_at = ? WHERE order_id = ?')
      .bind(new Date(Date.now() - 60000).toISOString(), order.id)
      .run();

    const login = await loginFounder(env);
    const page = await request(env, '/admin/inventory', { jar: login.jar });
    assert.equal(page.status, 200);

    const stock = await stockOf(env, timed.id);
    assert.equal(stock.reserved, 0, 'reservation released');
    assert.equal(stock.physical, 5, 'physical stock untouched');
    const released = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
    assert.equal(released.fulfilment_status, 'cancelled');
    const movement = await env.DB.prepare("SELECT * FROM inventory_movements WHERE reference_id = ? AND kind = 'release'").bind(order.id).first();
    assert.ok(movement, 'release is recorded in the ledger');
  });

  await t.test('Test 10 — preorders consume batch allocation, never physical stock', async () => {
    await setSetting(env, 'preorders_enabled', '1');
    const pre = await createProduct(env, {
      name: 'Preorder Ritual Set',
      sku: 'PRE-SET-1',
      stock: 0,
      status: 'active',
      fulfilment_model: 'preorder',
      preorder_enabled: 1,
    });
    const batch = await createBatch(env, pre, 10);

    const { order, location } = await placeOrder(env, { product: pre, qty: 2, email: 'pre@example.com' });
    assert.ok(order, `preorder checkout should succeed (redirect ${location})`);
    const item = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(order.id).first();
    assert.equal(item.fulfilment_model, 'preorder');
    assert.equal(item.batch_item_id, batch.itemId);

    let allocation = await env.DB.prepare('SELECT * FROM batch_items WHERE id = ?').bind(batch.itemId).first();
    assert.equal(allocation.preorder_holds, 2);
    assert.equal(allocation.preorder_qty, 0);
    assert.equal((await stockOf(env, pre.id)).physical, 0, 'no physical stock touched');

    await payOrder(env, order, { eventId: 'evt-test-10' });
    allocation = await env.DB.prepare('SELECT * FROM batch_items WHERE id = ?').bind(batch.itemId).first();
    assert.equal(allocation.preorder_holds, 0);
    assert.equal(allocation.preorder_qty, 2);
    assert.equal((await stockOf(env, pre.id)).physical, 0, 'payment does not create physical stock');

    // Over-allocation is refused: only 8 units remain in the batch.
    const over = await placeOrder(env, { product: pre, qty: 20, email: 'over@example.com' });
    assert.match(over.location, /error=/);
    allocation = await env.DB.prepare('SELECT * FROM batch_items WHERE id = ?').bind(batch.itemId).first();
    assert.equal(allocation.preorder_holds, 0);

    // Receiving the batch is the only thing that increases physical stock.
    const login = await loginFounder(env);
    const page = await sessionCsrf(env, `/admin/batches/${batch.batchId}`, login.jar);
    const received = await request(env, `/admin/batches/${batch.batchId}/receive`, {
      method: 'POST',
      jar: page.jar,
      form: { _csrf: page.csrf },
    });
    assert.equal(received.status, 303);
    assert.equal((await stockOf(env, pre.id)).physical, 10);
    const batchRow = await env.DB.prepare('SELECT * FROM production_batches WHERE id = ?').bind(batch.batchId).first();
    assert.equal(batchRow.status, 'received');

    // With preorders globally disabled, the product returns to waitlist mode.
    await setSetting(env, 'preorders_enabled', '0');
    const blocked = await placeOrder(env, { product: pre, qty: 1, email: 'disabled@example.com' });
    assert.match(blocked.location, /error=/);
  });
});
