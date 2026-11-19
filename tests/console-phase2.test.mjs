/** Founder Console: per-currency prices, product delete, zones, sample-data removal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceEnv, loginFounder, sessionCsrf, request } from './helpers.mjs';

const productForm = (o = {}) => ({
  name: 'Phase Two Oil', sku: 'P2-OIL-1', price: '50.00', currency: 'USD', cost: '10.00', status: 'active',
  fulfilment_model: 'inventory', preorder_enabled: '0', manual_unavailable: '0', low_stock_threshold: '5',
  opening_stock: '5', verification_status: 'verified', featured: '0', image_tone: 'deep', ...o,
});

test('Console phase 2', async (t) => {
  const env = await commerceEnv();
  const login = await loginFounder(env);
  const post = async (path, form, from = path) => {
    const page = await sessionCsrf(env, from, login.jar);
    return request(env, path, { method: 'POST', jar: login.jar, form: { _csrf: page.csrf, ...form } });
  };
  let id;

  await t.test('prices per currency are saved, edited and cleared', async () => {
    const res = await post('/admin/products', productForm({ price_GBP: '40.00', price_EUR: '46.50' }), '/admin/products/new');
    assert.equal(res.status, 303);
    id = (await env.DB.prepare("SELECT id FROM products WHERE sku = 'P2-OIL-1'").first()).id;
    const rows = (await env.DB.prepare('SELECT currency, price_cents FROM product_prices WHERE product_id = ? ORDER BY currency').bind(id).all()).results;
    assert.deepEqual(rows.map((r) => [r.currency, r.price_cents]), [['EUR', 4650], ['GBP', 4000], ['USD', 5000]]);
    await post(`/admin/products/${id}`, productForm({ price_GBP: '', price_EUR: '47.00', price_NGN: '75000' }), `/admin/products/${id}`);
    const after = (await env.DB.prepare('SELECT currency, price_cents FROM product_prices WHERE product_id = ? ORDER BY currency').bind(id).all()).results;
    assert.deepEqual(after.map((r) => [r.currency, r.price_cents]), [['EUR', 4700], ['NGN', 7500000], ['USD', 5000]]);
    const page = await request(env, `/admin/products/${id}`, { jar: login.jar });
    assert.match(page.text, /name="price_NGN"/);
  });

  await t.test('a zone can be created, assigned to a country, edited and deleted', async () => {
    const res = await post('/admin/shipping/zones', { name: 'United Kingdom', currency: 'GBP', shipping: '9.00', free_over: '100', duties_mode: 'ddp', duty_pct: '20', delivery_estimate: '5 to 9 days' }, '/admin/shipping');
    assert.equal(res.status, 303);
    const zone = await env.DB.prepare("SELECT * FROM shipping_zones WHERE name = 'United Kingdom'").first();
    assert.equal(zone.shipping_cents, 900);
    assert.equal(zone.free_over_cents, 10000);
    assert.equal(zone.duty_bps, 2000);
    assert.equal(zone.duties_mode, 'ddp');
    const country = await env.DB.prepare('SELECT * FROM supported_countries ORDER BY code LIMIT 1').first();
    await post(`/admin/shipping/${country.code}`, { enabled: '1', zone_id: zone.id, shipping: '', delivery_estimate: '', customs_note: '' }, '/admin/shipping');
    assert.equal((await env.DB.prepare('SELECT zone_id FROM country_zone WHERE country_code = ?').bind(country.code).first()).zone_id, zone.id);
    await post(`/admin/shipping/zones/${zone.id}`, { name: 'United Kingdom', currency: 'GBP', shipping: '12.00', duties_mode: 'ddu', duty_pct: '0' }, '/admin/shipping');
    assert.equal((await env.DB.prepare('SELECT shipping_cents FROM shipping_zones WHERE id = ?').bind(zone.id).first()).shipping_cents, 1200);
    await post(`/admin/shipping/zones/${zone.id}`, { action: 'delete' }, '/admin/shipping');
    assert.equal(await env.DB.prepare('SELECT id FROM shipping_zones WHERE id = ?').bind(zone.id).first(), null);
    assert.equal(await env.DB.prepare('SELECT 1 FROM country_zone WHERE zone_id = ?').bind(zone.id).first(), null);
  });

  await t.test('invalid zones are rejected', async () => {
    const res = await post('/admin/shipping/zones', { name: 'Bad', currency: 'XXX', shipping: '1', duty_pct: '10' }, '/admin/shipping');
    assert.match(res.headers.get('location') || '', /error=/);
    assert.equal(await env.DB.prepare("SELECT id FROM shipping_zones WHERE name = 'Bad'").first(), null);
  });

  await t.test('a never-ordered product can be deleted for good', async () => {
    const res = await post(`/admin/products/${id}`, { action: 'delete' }, `/admin/products/${id}`);
    assert.equal(res.status, 303);
    assert.equal(await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first(), null);
    assert.equal(await env.DB.prepare('SELECT 1 FROM product_prices WHERE product_id = ?').bind(id).first(), null);
  });

  await t.test('an ordered product cannot be deleted, only archived', async () => {
    const seeded = await env.DB.prepare('SELECT product_id FROM order_items LIMIT 1').first();
    assert.ok(seeded, 'the sample order is present');
    const res = await post(`/admin/products/${seeded.product_id}`, { action: 'delete' }, `/admin/products/${seeded.product_id}`);
    assert.match(res.headers.get('location') || '', /cannot%20be%20deleted/);
    assert.ok(await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(seeded.product_id).first());
  });

  await t.test('sample data can be removed', async () => {
    const before = (await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE payment_provider = 'sample'").first()).n;
    const res = await post('/admin/settings/purge-sample', {}, '/admin/settings');
    assert.equal(res.status, 303);
    const after = (await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE payment_provider = 'sample'").first()).n;
    assert.equal(after, 0);
    assert.equal(before, 1);
    assert.equal(await env.DB.prepare("SELECT 1 FROM customers WHERE email = 'sample.customer@example.com'").first(), null);
  });
});
