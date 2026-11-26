/** Orders CSV export: addresses, item counts, saved address book, spreadsheet-injection safety. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceEnv, loginFounder, request, placeOrder, createProduct } from './helpers.mjs';
import { csvSafe } from '../src/lib/http.js';

// Minimal CSV parser (handles quoted cells, doubled quotes, CRLF) so assertions read cells, not substrings.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && src[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

test('csvSafe neutralises formula triggers but keeps numbers and phone numbers readable', () => {
  assert.equal(csvSafe('=HYPERLINK("http://x","y")'), `'=HYPERLINK("http://x","y")`);
  assert.equal(csvSafe('@SUM(1)'), `'@SUM(1)`);
  assert.equal(csvSafe('+cmd|calc'), `'+cmd|calc`);
  assert.equal(csvSafe('-2+3+cmd'), `'-2+3+cmd`);
  assert.equal(csvSafe('+234 801 234 5678'), '+234 801 234 5678');
  assert.equal(csvSafe(4800), '4800');
  assert.equal(csvSafe(null), '');
  assert.equal(csvSafe('Ada Obi'), 'Ada Obi');
});

test('orders export carries addresses, item counts and saved addresses', async () => {
  const env = await commerceEnv();
  const login = await loginFounder(env);
  const serum = await createProduct(env, { name: 'Export Serum', sku: 'EXP-SER', stock: 20 });
  const balm = await createProduct(env, { name: 'Export Balm', sku: 'EXP-BAL', stock: 20 });

  const first = await placeOrder(env, { product: serum, qty: 3, email: 'export-a@example.com', name: 'Ada Obi' });
  assert.ok(first.order, 'order placed');
  // Saved address book entry on the same customer: one duplicate of the order address, one different.
  const customer = await env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind('export-a@example.com').first();
  const now = new Date().toISOString();
  for (const [id, line1, city, postcode, country] of [
    ['adr_dup', '1 Test Street', 'Lagos', '100001', 'NG'],
    ['adr_other', '9 Elm Road', 'Leeds', 'LS1 4AB', 'GB'],
  ]) {
    await env.DB.prepare('INSERT INTO addresses (id, customer_id, line1, city, postcode, country, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, customer.id, line1, city, postcode, country, now)
      .run();
  }
  // A second line on the same order so units and distinct products differ.
  await env.DB.prepare(
    `INSERT INTO order_items (id, order_id, product_id, name, sku, qty, unit_price_cents, line_total_cents, fulfilment_model)
     VALUES ('oit_extra', ?, ?, 'Export Balm', 'EXP-BAL', 2, 100, 200, 'inventory')`,
  ).bind(first.order.id, balm.id).run();

  const hostile = await placeOrder(env, { product: serum, qty: 1, email: 'export-b@example.com', name: '=HYPERLINK("http://evil.test","x")' });
  assert.ok(hostile.order);

  const res = await request(env, '/admin/orders/export.csv', { jar: login.jar });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const rows = parseCsv(res.text);
  const head = rows[0];
  const col = (name) => head.indexOf(name);
  for (const name of ['Items purchased', 'Distinct products', 'Products', 'Address line 1', 'City', 'Postcode', 'Other saved addresses on account']) {
    assert.ok(col(name) >= 0, `column ${name}`);
  }

  const mine = rows.find((r) => r[col('Reference')] === first.order.reference);
  assert.equal(mine[col('Items purchased')], '5');
  assert.equal(mine[col('Distinct products')], '2');
  assert.match(mine[col('Products')], /3 x Export Serum \(EXP-SER\)/);
  assert.equal(mine[col('Address line 1')], '1 Test Street');
  assert.equal(mine[col('City')], 'Lagos');
  assert.equal(mine[col('Postcode')], '100001');
  const others = mine[col('Other saved addresses on account')];
  assert.match(others, /9 Elm Road, Leeds, LS1 4AB, GB/);
  assert.doesNotMatch(others, /1 Test Street/, 'the order address is not repeated');

  const theirs = rows.find((r) => r[col('Reference')] === hostile.order.reference);
  assert.ok(theirs[col('Name')].startsWith("'="), 'formula in a customer name is defanged');
  assert.equal(theirs[col('Items purchased')], '1');
});

test('orders export stays behind console login', async () => {
  const env = await commerceEnv();
  const res = await request(env, '/admin/orders/export.csv');
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /\/admin\/login/);
});
