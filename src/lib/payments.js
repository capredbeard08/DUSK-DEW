/**
 * Payment architecture.
 *
 * - Provider credentials come only from environment secrets.
 * - A frontend "success" page is never trusted: orders are marked paid solely by
 *   server-side webhook verification or server-side provider verification.
 * - Webhooks are signature-checked and idempotent (payment_events unique key).
 * - Only configured and enabled providers are shown at checkout.
 */
import { all, audit, nowIso, one, run, stmt, uid } from './db.js';
import { hmacSha256Hex, timingSafeEqual } from './security.js';
import { commitOrderInventory, releaseOrderReservations } from './inventory.js';

export const PAYMENT_METHODS = [
  { provider: 'paystack', label: 'Card, bank transfer & mobile money (Paystack)', env: ['PAYSTACK_SECRET_KEY'] },
  { provider: 'paypal', label: 'PayPal Checkout', env: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'] },
];

export function offlinePaymentsEnabled(env) {
  return env.PAYMENTS_OFFLINE === '1';
}

export function providerConfigured(env, provider) {
  if (provider === 'paystack') return Boolean(env.PAYSTACK_SECRET_KEY);
  if (provider === 'paypal') return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
  if (provider === 'offline') return offlinePaymentsEnabled(env);
  return false;
}

/** Providers that are both configured in the environment and enabled by the founder. */
export async function enabledProviders(db, env, settings) {
  if (settings.payments_enabled !== '1') return [];
  const configured = (settings.payment_providers || 'paystack')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const list = [];
  for (const provider of configured) {
    if (providerConfigured(env, provider)) {
      const meta = PAYMENT_METHODS.find((p) => p.provider === provider);
      list.push({ provider, label: meta ? meta.label : provider });
    }
  }
  if (offlinePaymentsEnabled(env)) {
    list.push({ provider: 'offline', label: 'Test payment (sandbox — no real charge)' });
  }
  return list;
}

export function newPaymentReference() {
  return `DDPAY-${Date.now().toString(36).toUpperCase()}-${uid().slice(0, 8).toUpperCase()}`;
}

/**
 * Create a pending payment record and, for a configured real provider, a hosted
 * checkout session. Returns { ok, redirectUrl?, reference, error? }.
 */
export async function createPaymentSession(db, env, settings, order) {
  const enabled = await enabledProviders(db, env, settings);
  const preferred = settings.payment_provider || 'paystack';
  const chosen = enabled.find((p) => p.provider === preferred) || enabled[0];
  if (!chosen) {
    return { ok: false, error: 'No verified payment provider is configured. Payments are disabled.' };
  }
  const reference = newPaymentReference();
  await run(
    db,
    `INSERT INTO payments (id, order_id, provider, reference, amount_cents, currency, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    uid('pay_'),
    order.id,
    chosen.provider,
    reference,
    order.total_cents,
    order.currency,
    nowIso(),
  );
  await run(
    db,
    `UPDATE orders SET payment_status = 'pending', payment_provider = ?, payment_reference = ?, updated_at = ? WHERE id = ?`,
    chosen.provider,
    reference,
    nowIso(),
    order.id,
  );

  if (chosen.provider === 'paystack') {
    try {
      const res = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: order.email,
          amount: order.total_cents,
          currency: order.currency,
          reference,
          callback_url: `${env.APP_ORIGIN || new URL(order.origin || 'https://example.com').origin}/order/${order.reference}`,
          metadata: { order_reference: order.reference },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.status) {
        await run(db, `UPDATE payments SET status = 'failed', failure_reason = ? WHERE reference = ?`, 'Paystack initialisation failed', reference);
        return { ok: false, error: 'Payment session could not be created. Please try again or contact support.', reference };
      }
      await run(db, 'UPDATE payments SET provider_reference = ? WHERE reference = ?', data.data.reference, reference);
      return { ok: true, reference, redirectUrl: data.data.authorization_url };
    } catch (err) {
      await run(db, `UPDATE payments SET status = 'failed', failure_reason = ? WHERE reference = ?`, String(err).slice(0, 200), reference);
      return { ok: false, error: 'Payment provider unreachable. Please try again.', reference };
    }
  }

  if (chosen.provider === 'paypal') {
    try {
      const token = await paypalToken(env);
      const origin = env.APP_ORIGIN || '';
      const res = await fetch(`${paypalBase(env)}/v2/checkout/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [
            {
              reference_id: order.reference,
              description: `DUSK & DEW order ${order.reference}`,
              amount: { currency_code: order.currency, value: (order.total_cents / 100).toFixed(2) },
            },
          ],
          application_context: {
            return_url: `${origin}/order/${order.reference}`,
            cancel_url: `${origin}/checkout`,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await run(db, `UPDATE payments SET status = 'failed', failure_reason = ? WHERE reference = ?`, 'PayPal order creation failed', reference);
        return { ok: false, error: 'PayPal session could not be created.', reference };
      }
      await run(db, 'UPDATE payments SET provider_reference = ? WHERE reference = ?', data.id, reference);
      const link = (data.links || []).find((l) => l.rel === 'approve');
      return { ok: true, reference, redirectUrl: link ? link.href : null };
    } catch (err) {
      await run(db, `UPDATE payments SET status = 'failed', failure_reason = ? WHERE reference = ?`, String(err).slice(0, 200), reference);
      return { ok: false, error: 'PayPal unreachable. Please try again.', reference };
    }
  }

  return { ok: true, reference, redirectUrl: `/pay/${encodeURIComponent(reference)}` };
}

export function paypalBase(env) {
  return env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

export async function paypalToken(env) {
  const res = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  return data.access_token;
}

/**
 * Mark an order paid after server-side verification. Safe to call repeatedly.
 */
export async function confirmOrderPayment(db, orderId, { provider, reference, providerReference, amountCents, eventId = null, actorEmail = null, userId = null }) {
  const order = await one(db, 'SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) return { ok: false, error: 'order_not_found' };
  if (order.payment_status === 'paid') return { ok: true, alreadyProcessed: true };
  if (order.payment_status === 'refunded') return { ok: false, error: 'order_refunded' };
  if (Number(amountCents) !== Number(order.total_cents)) {
    await audit(db, {
      action: 'payment.amount_mismatch',
      entityType: 'order',
      entityId: order.id,
      details: { expected: order.total_cents, received: amountCents, reference },
      actorEmail,
    });
    await run(db, `UPDATE orders SET internal_notes = COALESCE(internal_notes,'') || ?, updated_at = ? WHERE id = ?`, `\n[${nowIso()}] Payment amount mismatch (expected ${order.total_cents}, got ${amountCents}).`, nowIso(), order.id);
    return { ok: false, error: 'amount_mismatch' };
  }

  const now = nowIso();
  const payment = await one(db, 'SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1', orderId);
  if (payment) {
    await run(
      db,
      `UPDATE payments SET status = 'succeeded', provider_reference = COALESCE(?, provider_reference), verified_at = ? WHERE id = ? AND status <> 'succeeded'`,
      providerReference || null,
      now,
      payment.id,
    );
  }

  const committed = await commitOrderInventory(db, orderId, { userId });
  if (!committed.ok) {
    await run(
      db,
      `UPDATE orders SET payment_status = 'paid', fulfilment_status = 'needs_attention', stock_issue = 1,
        paid_at = ?, updated_at = ? WHERE id = ?`,
      now,
      now,
      orderId,
    );
    await releaseOrderReservations(db, orderId, 'Stock could not be fulfilled after payment');
    await audit(db, {
      action: 'payment.received_stock_shortfall',
      entityType: 'order',
      entityId: orderId,
      details: { error: committed.error, reference },
      actorEmail,
    });
    await queueEmail(db, {
      to: order.email,
      templateKey: 'payment_confirmation',
      orderId,
      data: { name: order.name, reference: order.reference, total: order.total_cents },
    });
    return { ok: true, stockIssue: true, orderId };
  }

  const hasPreorder = await one(db, `SELECT COUNT(*) AS c FROM order_items WHERE order_id = ? AND fulfilment_model = 'preorder'`, orderId);
  const hasStock = await one(db, `SELECT COUNT(*) AS c FROM order_items WHERE order_id = ? AND fulfilment_model = 'inventory'`, orderId);
  const nextFulfilment = Number(hasPreorder?.c) > 0 && Number(hasStock?.c) === 0 ? 'production_pending' : 'processing';

  await run(
    db,
    `UPDATE orders SET payment_status = 'paid', fulfilment_status = ?, paid_at = ?, updated_at = ? WHERE id = ?`,
    nextFulfilment,
    now,
    now,
    orderId,
  );
  await audit(db, {
    action: 'payment.confirmed',
    entityType: 'order',
    entityId: orderId,
    details: { provider, reference, amountCents },
    actorEmail,
  });
  await queueEmail(db, {
    to: order.email,
    templateKey: 'payment_confirmation',
    orderId,
    data: { name: order.name, reference: order.reference, total: order.total_cents },
  });
  await queueEmail(db, {
    to: order.email,
    templateKey: 'order_confirmation',
    orderId,
    data: { name: order.name, reference: order.reference, total: order.total_cents },
  });
  return { ok: true, orderId };
}

export async function markPaymentFailed(db, reference, reason) {
  const payment = await one(db, 'SELECT * FROM payments WHERE reference = ?', reference);
  if (!payment) return { ok: false, error: 'payment_not_found' };
  const order = await one(db, 'SELECT * FROM orders WHERE id = ?', payment.order_id);
  if (order && order.payment_status === 'paid') return { ok: true, alreadyPaid: true };
  await run(
    db,
    `UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ? AND status <> 'succeeded'`,
    String(reason || 'Payment failed').slice(0, 200),
    payment.id,
  );
  if (order) {
    await run(
      db,
      `UPDATE orders SET payment_status = 'failed', updated_at = ? WHERE id = ? AND payment_status <> 'paid'`,
      nowIso(),
      order.id,
    );
    await releaseOrderReservations(db, order.id, 'Payment failed');
  }
  return { ok: true, orderId: order ? order.id : null };
}

/**
 * Verify + process a webhook. Returns { status, body }.
 * Invalid signatures are rejected before the payload is trusted.
 */
export async function handleWebhook(db, env, provider, rawBody, headers) {
  if (provider === 'paystack') {
    const secret = env.PAYSTACK_SECRET_KEY || env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) return { status: 503, body: { error: 'Webhook secret not configured' } };
    const signature = headers.get('x-paystack-signature') || '';
    const expected = await hmacSha256Hex(secret, rawBody);
    if (!signature || !timingSafeEqual(signature, expected)) {
      return { status: 401, body: { error: 'Invalid signature' } };
    }
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return { status: 400, body: { error: 'Invalid JSON' } };
    }
    return processPaystackEvent(db, env, event);
  }

  if (provider === 'paypal') {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET || !env.PAYPAL_WEBHOOK_ID) {
      return { status: 503, body: { error: 'PayPal webhooks not configured' } };
    }
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return { status: 400, body: { error: 'Invalid JSON' } };
    }
    const verified = await verifyPaypalWebhook(env, headers, event);
    if (!verified) return { status: 401, body: { error: 'Invalid signature' } };
    return processPaypalEvent(db, env, event);
  }

  return { status: 404, body: { error: 'Unknown provider' } };
}

async function processPaystackEvent(db, env, event) {
  const data = event.data || {};
  const eventId = String(data.id || `${event.event}:${data.reference}`);
  const dedupe = await db
    .prepare(`INSERT OR IGNORE INTO payment_events (id, provider, event_id, event_type, reference, payload, received_at) VALUES (?, 'paystack', ?, ?, ?, ?, ?)`)
    .bind(uid('evt_'), eventId, event.event, data.reference || null, JSON.stringify(event).slice(0, 20000), nowIso())
    .run();
  if (!dedupe.meta || dedupe.meta.changes !== 1) {
    return { status: 200, body: { received: true, duplicate: true } };
  }
  const payment = data.reference
    ? await one(db, 'SELECT * FROM payments WHERE reference = ?', data.reference)
    : null;
  if (!payment) {
    await audit(db, { action: 'webhook.unknown_reference', entityType: 'payment', entityId: data.reference || null, details: { provider: 'paystack', event: event.event } });
    return { status: 200, body: { received: true, ignored: true } };
  }
  if (event.event === 'charge.success' && data.status === 'success') {
    const result = await confirmOrderPayment(db, payment.order_id, {
      provider: 'paystack',
      reference: data.reference,
      providerReference: data.reference,
      amountCents: data.amount,
      eventId,
    });
    return { status: 200, body: { received: true, result } };
  }
  if (event.event === 'charge.failed' || data.status === 'failed') {
    await markPaymentFailed(db, data.reference, data.gateway_response || 'Payment failed');
    return { status: 200, body: { received: true } };
  }
  return { status: 200, body: { received: true, ignored: true } };
}

async function verifyPaypalWebhook(env, headers, event) {
  const token = await paypalToken(env);
  const res = await fetch(`${paypalBase(env)}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: headers.get('paypal-auth-algo'),
      cert_url: headers.get('paypal-cert-url'),
      transmission_id: headers.get('paypal-transmission-id'),
      transmission_sig: headers.get('paypal-transmission-sig'),
      transmission_time: headers.get('paypal-transmission-time'),
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    }),
  });
  const data = await res.json().catch(() => ({}));
  return data.verification_status === 'SUCCESS';
}

async function processPaypalEvent(db, env, event) {
  const resource = event.resource || {};
  const eventId = event.id || `${event.event_type}:${resource.id}`;
  const dedupe = await db
    .prepare(`INSERT OR IGNORE INTO payment_events (id, provider, event_id, event_type, reference, payload, received_at) VALUES (?, 'paypal', ?, ?, ?, ?, ?)`)
    .bind(uid('evt_'), eventId, event.event_type, resource.id || null, JSON.stringify(event).slice(0, 20000), nowIso())
    .run();
  if (!dedupe.meta || dedupe.meta.changes !== 1) return { status: 200, body: { received: true, duplicate: true } };

  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED' || event.event_type === 'CHECKOUT.ORDER.APPROVED') {
    const payment = await one(
      db,
      `SELECT p.* FROM payments p WHERE p.provider = 'paypal' AND
        (p.provider_reference = ? OR p.reference = ? OR p.order_id IN (SELECT id FROM orders WHERE payment_reference = ?))`,
      resource.supplementary_data?.related_ids?.order_id || resource.id,
      resource.purchase_units?.[0]?.reference_id,
      resource.purchase_units?.[0]?.reference_id,
    );
    if (!payment) return { status: 200, body: { received: true, ignored: true } };
    const amount = resource.amount ? Math.round(Number(resource.amount.value) * 100) : payment.amount_cents;
    const result = await confirmOrderPayment(db, payment.order_id, {
      provider: 'paypal',
      reference: payment.reference,
      providerReference: resource.id,
      amountCents: amount,
      eventId,
    });
    return { status: 200, body: { received: true, result } };
  }
  return { status: 200, body: { received: true, ignored: true } };
}

/**
 * Server-side verification used on the return page. Never trusts query params alone.
 */
export async function verifyReturn(db, env, order) {
  if (!order.payment_reference) return { ok: false, error: 'no_reference' };
  const payment = await one(db, 'SELECT * FROM payments WHERE reference = ?', order.payment_reference);
  if (!payment) return { ok: false, error: 'payment_not_found' };
  if (payment.status === 'succeeded' || order.payment_status === 'paid') return { ok: true, already: true };

  if (payment.provider === 'paystack' && env.PAYSTACK_SECRET_KEY) {
    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(payment.reference)}`, {
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
    });
    const data = await res.json().catch(() => ({}));
    if (data?.data?.status === 'success') {
      await confirmOrderPayment(db, order.id, {
        provider: 'paystack',
        reference: payment.reference,
        providerReference: data.data.reference,
        amountCents: data.data.amount,
      });
      return { ok: true };
    }
    return { ok: false, error: 'not_successful' };
  }

  if (payment.provider === 'paypal') {
    const token = await paypalToken(env);
    const res = await fetch(`${paypalBase(env)}/v1/checkout/orders/${payment.provider_reference}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (data.status === 'COMPLETED' || data.status === 'APPROVED') {
      const amount = Math.round(Number(data.purchase_units?.[0]?.amount?.value || 0) * 100);
      await confirmOrderPayment(db, order.id, {
        provider: 'paypal',
        reference: payment.reference,
        providerReference: data.id,
        amountCents: amount,
      });
      return { ok: true };
    }
    return { ok: false, error: 'not_successful' };
  }

  return { ok: false, error: 'not_configured' };
}

/**
 * Test/sandbox capture. Only reachable when PAYMENTS_OFFLINE=1, so production
 * traffic can never mark an order paid without the provider.
 */
export async function completeOfflinePayment(db, env, reference) {
  if (!offlinePaymentsEnabled(env)) return { ok: false, error: 'disabled' };
  const payment = await one(db, 'SELECT * FROM payments WHERE reference = ?', reference);
  if (!payment || payment.provider !== 'offline') return { ok: false, error: 'not_found' };
  return confirmOrderPayment(db, payment.order_id, {
    provider: 'offline',
    reference,
    providerReference: reference,
    amountCents: payment.amount_cents,
    eventId: `offline:${reference}`,
  });
}

export async function refundOrder(db, env, { orderId, amountCents, reason, restock = false, userId = null, actorEmail = null }) {
  const order = await one(db, 'SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) return { ok: false, error: 'Order not found' };
  if (order.payment_status !== 'paid' && order.payment_status !== 'partially_refunded') {
    return { ok: false, error: 'Only paid orders can be refunded' };
  }
  const payment = await one(db, `SELECT * FROM payments WHERE order_id = ? AND status IN ('succeeded','partially_refunded') ORDER BY created_at DESC LIMIT 1`, orderId);
  if (!payment) return { ok: false, error: 'No captured payment to refund' };
  const refundedRow = await one(db, `SELECT COALESCE(SUM(amount_cents),0) AS total FROM refunds WHERE order_id = ? AND status = 'succeeded'`, orderId);
  const already = Number(refundedRow.total || 0);
  const amount = Number(amountCents);
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: 'Refund amount must be a positive whole number of cents' };
  if (amount + already > payment.amount_cents) return { ok: false, error: 'Refund exceeds the captured payment amount' };

  let providerRef = null;
  if (payment.provider === 'paystack' && !offlinePaymentsEnabled(env)) {
    if (!env.PAYSTACK_SECRET_KEY) return { ok: false, error: 'Paystack is not configured' };
    const res = await fetch('https://api.paystack.co/refund', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: payment.provider_reference || payment.reference, amount }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.status) return { ok: false, error: data.message || 'Refund failed at Paystack' };
    providerRef = String(data.data?.id || '');
  }
  if (payment.provider === 'paypal') {
    if (!env.PAYPAL_CLIENT_ID) return { ok: false, error: 'PayPal is not configured' };
    const token = await paypalToken(env);
    const res = await fetch(`${paypalBase(env)}/v2/payments/captures/${payment.provider_reference}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: { currency_code: payment.currency, value: (amount / 100).toFixed(2) } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.message || 'Refund failed at PayPal' };
    providerRef = data.id || null;
  }

  const now = nowIso();
  const totalRefunded = already + amount;
  const newPaymentStatus = totalRefunded >= payment.amount_cents ? 'refunded' : 'partially_refunded';
  await db.batch([
    stmt(
      db,
      `INSERT INTO refunds (id, order_id, payment_id, amount_cents, reason, status, provider_refund_reference, user_id, actor_email, created_at)
       VALUES (?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, ?)`,
      uid('ref_'),
      orderId,
      payment.id,
      amount,
      reason || null,
      providerRef,
      userId,
      actorEmail,
      now,
    ),
    stmt(db, 'UPDATE payments SET status = ? WHERE id = ?', newPaymentStatus, payment.id),
    stmt(
      db,
      `UPDATE orders SET payment_status = ?, fulfilment_status = ?, updated_at = ? WHERE id = ?`,
      newPaymentStatus,
      newPaymentStatus === 'refunded' ? 'refunded' : order.fulfilment_status,
      now,
      orderId,
    ),
    stmt(
      db,
      `INSERT INTO order_notes (id, order_id, user_id, actor_email, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      uid('note_'),
      orderId,
      userId,
      actorEmail,
      `Refund recorded: ${(amount / 100).toFixed(2)} ${payment.currency}. ${reason || ''}`.trim(),
      now,
    ),
  ]);

  if (restock) {
    const items = await all(db, 'SELECT * FROM order_items WHERE order_id = ? AND fulfilment_model = ?', orderId, 'inventory');
    for (const item of items) {
      await run(
        db,
        `UPDATE inventory SET physical_stock = physical_stock + ?, units_sold = MAX(0, units_sold - ?), updated_at = ? WHERE product_id = ?`,
        item.qty,
        item.qty,
        now,
        item.product_id,
      );
      await run(
        db,
        `INSERT INTO inventory_movements (id, product_id, kind, qty_delta, physical_after, reserved_after, reason, reference_type, reference_id, user_id, created_at)
         SELECT ?, product_id, 'refund_return', ?, physical_stock, reserved_stock, ?, 'refund', ?, ?, ? FROM inventory WHERE product_id = ?`,
        uid('mov_'),
        item.qty,
        `Returned stock from refund on order ${order.reference}`,
        orderId,
        userId,
        now,
        item.product_id,
      );
    }
  }

  await audit(db, {
    action: 'refund.issued',
    entityType: 'order',
    entityId: orderId,
    details: { amount, totalRefunded, restock, provider: payment.provider },
    userId,
    actorEmail,
  });
  await queueEmail(db, {
    to: order.email,
    templateKey: 'refund_confirmation',
    orderId,
    data: { name: order.name, reference: order.reference, amount: amount / 100 },
  });
  return { ok: true, totalRefunded, status: newPaymentStatus };
}

/* Imported lazily to avoid a circular import at module load. */
async function queueEmail(db, args) {
  const { queueEmail: queue } = await import('./email.js');
  return queue(db, args);
}
