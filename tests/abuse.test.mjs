/** Abuse resistance: attempts to obtain goods without paying, hoard stock, or brute-force logins. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceEnv, placeOrder, payOrder, request, getCsrf } from './helpers.mjs';
import { verifyReturn } from '../src/lib/payments.js';
import { quoteOrder } from '../src/lib/pricing.js';

const firstProduct = (env) => env.DB.prepare("SELECT * FROM products WHERE status = 'active' ORDER BY id LIMIT 1").first();
const paymentStatus = async (env, id) => (await env.DB.prepare('SELECT payment_status FROM orders WHERE id = ?').bind(id).first()).payment_status;

test('right number, wrong currency never marks an order paid', async () => {
  const env = await commerceEnv();
  const { order } = await placeOrder(env, { product: await firstProduct(env) });
  assert.ok(order, 'order created');
  const wrong = await payOrder(env, order, { currency: order.currency === 'NGN' ? 'USD' : 'NGN' });
  assert.equal(wrong.status, 200);
  assert.notEqual(await paymentStatus(env, order.id), 'paid');
  const ok = await payOrder(env, order);
  assert.equal(ok.status, 200);
  assert.equal(await paymentStatus(env, order.id), 'paid');
});

test('a provider report with no currency is rejected', async () => {
  const env = await commerceEnv();
  const { order } = await placeOrder(env, { product: await firstProduct(env) });
  const payload = JSON.stringify({ event: 'charge.success', data: { id: 1, reference: order.payment_reference, status: 'success', amount: order.total_cents } });
  const { signWebhook } = await import('./helpers.mjs');
  const res = await request(env, '/webhooks/paystack', { method: 'POST', raw: payload, headers: { 'x-paystack-signature': await signWebhook(payload) } });
  assert.equal(res.status, 200);
  assert.notEqual(await paymentStatus(env, order.id), 'paid');
});

test('an order with no payable total cannot be quoted', async () => {
  const env = await commerceEnv();
  const product = { ...(await firstProduct(env)), price_cents: 0 };
  const country = { code: 'NG', shipping_cents: 0 };
  const q = await quoteOrder(env.DB, { country, lines: [{ product, qty: 1 }], defaultCurrency: product.currency });
  assert.equal(q.ok, false);
});

test('PayPal: an approved-but-uncaptured order is captured server-side before it counts as paid', async () => {
  const env = await commerceEnv();
  const { order } = await placeOrder(env, { product: await firstProduct(env) });
  await env.DB.prepare("UPDATE payments SET provider = 'paypal', provider_reference = 'PP-ORDER-1' WHERE order_id = ?").bind(order.id).run();
  env.PAYPAL_CLIENT_ID = 'id';
  env.PAYPAL_CLIENT_SECRET = 'secret';
  const amount = (order.total_cents / 100).toFixed(2);
  const calls = [];
  const realFetch = globalThis.fetch;
  let captureStatus = 'COMPLETED';
  globalThis.fetch = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url}`);
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('/oauth2/token')) return json({ access_token: 't' });
    if (String(url).endsWith('/capture')) {
      return json({ id: 'PP-ORDER-1', status: captureStatus, purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: captureStatus, amount: { value: amount, currency_code: order.currency } }] } }] });
    }
    return json({ id: 'PP-ORDER-1', status: 'APPROVED' });
  };
  try {
    const result = await verifyReturn(env.DB, env, order);
    assert.equal(result.ok, true);
    assert.ok(calls.some((c) => c.startsWith('POST') && c.endsWith('/capture')), 'capture was requested');
    assert.equal(await paymentStatus(env, order.id), 'paid');
    assert.equal((await env.DB.prepare('SELECT provider_reference FROM payments WHERE order_id = ?').bind(order.id).first()).provider_reference, 'CAP-1');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('PayPal: approval alone, or a failed capture, never marks an order paid', async () => {
  const env = await commerceEnv();
  const { order } = await placeOrder(env, { product: await firstProduct(env) });
  await env.DB.prepare("UPDATE payments SET provider = 'paypal', provider_reference = 'PP-ORDER-2' WHERE order_id = ?").bind(order.id).run();
  env.PAYPAL_CLIENT_ID = 'id';
  env.PAYPAL_CLIENT_SECRET = 'secret';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('/oauth2/token')) return json({ access_token: 't' });
    if (String(url).endsWith('/capture')) return json({ status: 'PAYER_ACTION_REQUIRED' });
    return json({ id: 'PP-ORDER-2', status: 'APPROVED' });
  };
  try {
    const result = await verifyReturn(env.DB, env, order);
    assert.equal(result.ok, false);
    assert.notEqual(await paymentStatus(env, order.id), 'paid');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('one buyer cannot hold unlimited stock with unpaid orders', async () => {
  const env = await commerceEnv();
  const product = await firstProduct(env);
  const results = [];
  for (let i = 0; i < 4; i += 1) {
    results.push(await placeOrder(env, { product, email: 'hoarder@example.com' }));
  }
  const created = results.filter((r) => r.location.startsWith('/pay/')).length;
  assert.equal(created, 3, 'a fourth open order for the same email is refused');
  assert.match(results[3].location, /error=/);
});

test('one address cannot open orders in bulk', async () => {
  const env = await commerceEnv();
  const product = await firstProduct(env);
  let created = 0;
  for (let i = 0; i < 8; i += 1) {
    const r = await placeOrder(env, { product, ip: '203.0.113.9' });
    if (r.location.startsWith('/pay/')) created += 1;
  }
  assert.equal(created, 6);
});

test('a single console account cannot be brute-forced from many addresses', async () => {
  const env = await commerceEnv();
  let blocked = false;
  for (let i = 0; i < 14; i += 1) {
    const ip = `198.51.100.${i + 1}`;
    const page = await request(env, '/admin/login', { headers: { 'cf-connecting-ip': ip } });
    const csrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
    const res = await request(env, '/admin/login', { method: 'POST', jar: page.jar, headers: { 'cf-connecting-ip': ip }, form: { _csrf: csrf, email: 'founder@duskanddew.com', password: `wrong-guess-${i}` } });
    if (res.status === 429) blocked = true;
  }
  assert.equal(blocked, true);
});

test('responses carry HSTS and frame protection', async () => {
  const env = await commerceEnv();
  const res = await request(env, '/');
  assert.match(res.headers.get('strict-transport-security') || '', /max-age=\d+/);
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
});
