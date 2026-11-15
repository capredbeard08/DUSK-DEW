/** Payment acceptance tests: success, failure, duplication, signatures, refunds, failure handling. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commerceEnv,
  createProduct,
  placeOrder,
  payOrder,
  loginFounder,
  sessionCsrf,
  request,
  stockOf,
  signWebhook,
  WEBHOOK_SECRET,
} from './helpers.mjs';

async function refund(env, jar, order, dollars, reason = 'Customer request') {
  const page = await sessionCsrf(env, `/admin/orders/${order.id}`, jar);
  const res = await request(env, `/admin/orders/${order.id}/refund`, {
    method: 'POST',
    jar: page.jar,
    form: { _csrf: page.csrf, amount: String(dollars), reason, restock: '0' },
  });
  return { res, page };
}

test('Payment processing', async (t) => {
  const env = await commerceEnv();
  const product = await createProduct(env, { name: 'Payment Test Serum', sku: 'PAY-TEST-1', stock: 50 });
  let paidOrder = null;

  await t.test('successful payment is verified server-side and commits stock', async () => {
    const { order } = await placeOrder(env, { product, qty: 2, email: 'paid@example.com' });
    assert.ok(order);
    assert.equal(order.payment_status, 'pending');
    const payment = await env.DB.prepare('SELECT * FROM payments WHERE order_id = ?').bind(order.id).first();
    assert.equal(payment.status, 'pending');
    assert.equal(payment.amount_cents, order.total_cents);

    const hook = await payOrder(env, order, { eventId: 'pay-evt-success' });
    assert.equal(hook.status, 200);

    const settled = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
    assert.equal(settled.payment_status, 'paid');
    assert.ok(settled.paid_at);
    const settledPayment = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(payment.id).first();
    assert.equal(settledPayment.status, 'succeeded');
    assert.ok(settledPayment.verified_at);
    assert.equal((await stockOf(env, product.id)).physical, 48);
    const emails = await env.DB.prepare('SELECT * FROM email_notifications WHERE order_id = ?').bind(order.id).all();
    assert.ok(emails.results.length >= 2, 'payment and order confirmation emails queued');
    paidOrder = settled;
  });

  await t.test('a success page alone cannot mark an order paid', async () => {
    const { order } = await placeOrder(env, { product, qty: 1, email: 'noserver@example.com' });
    // Visiting the order page does not verify anything without a provider reference.
    const page = await request(env, `/order/${order.reference}?email=noserver@example.com`);
    assert.equal(page.status, 200);
    const reloaded = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
    assert.equal(reloaded.payment_status, 'pending');
    assert.equal((await stockOf(env, product.id)).physical, 48);
  });

  await t.test('failed payment releases the reservation and never deducts stock', async () => {
    const before = await stockOf(env, product.id);
    const { order } = await placeOrder(env, { product, qty: 1, email: 'declined@example.com' });
    assert.equal((await stockOf(env, product.id)).reserved, before.reserved + 1, 'reservation held while pending');
    const hook = await payOrder(env, order, { event: 'charge.failed', status: 'failed', eventId: 'pay-evt-failed' });
    assert.equal(hook.status, 200);
    const after = await stockOf(env, product.id);
    assert.equal(after.physical, before.physical, 'no stock deducted for a failed payment');
    assert.equal(after.reserved, before.reserved, 'reservation released');
    const reloaded = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
    assert.equal(reloaded.payment_status, 'failed');
  });

  await t.test('invalid webhook signature is rejected without touching state', async () => {
    const { order } = await placeOrder(env, { product, qty: 1, email: 'forged@example.com' });
    const before = await stockOf(env, product.id);
    const hook = await payOrder(env, order, { eventId: 'pay-evt-forged', signature: 'deadbeef' });
    assert.equal(hook.status, 401);
    const reloaded = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
    assert.equal(reloaded.payment_status, 'pending');
    assert.equal((await stockOf(env, product.id)).reserved, before.reserved);
    const event = await env.DB.prepare('SELECT * FROM payment_events WHERE event_id = ?').bind('pay-evt-forged').first();
    assert.equal(event, null, 'untrusted events are not recorded');
  });

  await t.test('a webhook signed with the wrong secret is rejected', async () => {
    const { order } = await placeOrder(env, { product, qty: 1, email: 'wrongsecret@example.com' });
    const payload = JSON.stringify({ event: 'charge.success', data: { id: 'wrong-secret-1', reference: order.payment_reference, status: 'success', amount: order.total_cents } });
    const signature = await signWebhook(payload, 'not-the-secret');
    const hook = await request(env, '/webhooks/paystack', { method: 'POST', raw: payload, headers: { 'x-paystack-signature': signature } });
    assert.equal(hook.status, 401);
    const reloaded = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
    assert.equal(reloaded.payment_status, 'pending');
    assert.ok(WEBHOOK_SECRET);
  });

  await t.test('refunds: partial then full, with reconciliation', async () => {
    const login = await loginFounder(env);
    const partial = await refund(env, login.jar, paidOrder, 10, 'Goodwill');
    assert.equal(partial.res.status, 303);
    assert.match(partial.res.headers.get('location'), /notice=/);
    let order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(paidOrder.id).first();
    assert.equal(order.payment_status, 'partially_refunded');
    let refundsRow = await env.DB.prepare('SELECT * FROM refunds WHERE order_id = ?').bind(order.id).all();
    assert.equal(refundsRow.results.length, 1);
    assert.equal(refundsRow.results[0].amount_cents, 1000);

    const remaining = (order.total_cents - 1000) / 100;
    const full = await refund(env, login.jar, order, remaining, 'Remaining balance');
    assert.equal(full.res.status, 303);
    order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
    assert.equal(order.payment_status, 'refunded');
    assert.equal(order.fulfilment_status, 'refunded');
    refundsRow = await env.DB.prepare('SELECT * FROM refunds WHERE order_id = ?').bind(order.id).all();
    assert.equal(refundsRow.results.length, 2);
    const payment = await env.DB.prepare("SELECT * FROM payments WHERE order_id = ? AND provider = 'offline'").bind(order.id).first();
    assert.equal(payment.status, 'refunded');
  });

  await t.test('refund cannot exceed the captured amount', async () => {
    const login = await loginFounder(env);
    const { order } = await placeOrder(env, { product, qty: 1, email: 'overrefund@example.com' });
    await payOrder(env, order, { eventId: 'pay-evt-overrefund' });
    const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
    const page = await sessionCsrf(env, `/admin/orders/${order.id}`, login.jar);
    const res = await request(env, `/admin/orders/${order.id}/refund`, {
      method: 'POST',
      jar: page.jar,
      form: { _csrf: page.csrf, amount: String((fresh.total_cents + 5000) / 100), reason: 'Too much' },
    });
    assert.match(res.headers.get('location'), /error=/);
    const refundsRow = await env.DB.prepare('SELECT * FROM refunds WHERE order_id = ?').bind(order.id).all();
    assert.equal(refundsRow.results.length, 0);
  });

  await t.test('payment received but stock cannot be fulfilled flags the order for the founder', async () => {
    const { order } = await placeOrder(env, { product, qty: 1, email: 'shortfall@example.com' });
    // Simulate stock being lost between reservation and payment confirmation.
    await env.DB.prepare("UPDATE inventory_reservations SET status = 'released' WHERE order_id = ?").bind(order.id).run();
    await env.DB.prepare('UPDATE inventory SET reserved_stock = 0 WHERE product_id = ?').bind(product.id).run();

    const hook = await payOrder(env, order, { eventId: 'pay-evt-shortfall' });
    assert.equal(hook.status, 200);
    const flagged = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
    assert.equal(flagged.payment_status, 'paid');
    assert.equal(flagged.fulfilment_status, 'needs_attention');
    assert.equal(flagged.stock_issue, 1);

    const login = await loginFounder(env);
    const dashboard = await request(env, '/admin', { jar: login.jar });
    assert.match(dashboard.text, /could not be fulfilled/i);
    const detail = await request(env, `/admin/orders/${order.id}`, { jar: login.jar });
    assert.match(detail.text, /Stock could not be fulfilled/i);
  });
});
