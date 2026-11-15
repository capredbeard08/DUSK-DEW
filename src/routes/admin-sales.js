/** Founder Console: orders, customers, preorders and production batches. */
import { all, audit, nowIso, one, run, settingsMap, uid } from '../lib/db.js';
import { cleanText, clientIp, isSameOrigin, verifyCsrf, can } from '../lib/security.js';
import { parseDollars, readForm, redirect, html, intOr } from '../lib/http.js';
import { releaseOrderReservations, receiveBatch } from '../lib/inventory.js';
import { refundOrder, enabledProviders } from '../lib/payments.js';
import { queueEmail } from '../lib/email.js';
import { ordersPage, orderDetailPage, customersPage, preordersPage, batchesPage, batchDetailPage } from '../views/console.js';

const FULFILMENT_STATUSES = ['awaiting_payment', 'paid', 'processing', 'production_pending', 'ready_for_dispatch', 'shipped', 'delivered', 'cancelled', 'refunded', 'needs_attention'];
const BATCH_STATUSES = ['planned', 'awaiting_manufacturer', 'production_started', 'quality_review', 'completed', 'received', 'cancelled'];

const consoleBase = (auth, settings, request) => ({
  settings,
  user: auth.user,
  csrf: auth.csrfToken,
  searchParams: new URL(request.url).searchParams,
});

async function postForm(request, auth) {
  const form = await readForm(request);
  const ok = Boolean(form && isSameOrigin(request) && verifyCsrf(form, auth, request));
  return { form, ok };
}

function forbidden() {
  return html('<h1>Not authorised</h1><p>Your role does not permit this action.</p>', 403);
}

async function loadOrder(db, id) {
  return one(db, 'SELECT * FROM orders WHERE id = ? OR reference = ?', id, id);
}

export async function handleAdminSales({ db, request, env, url, path, method, auth }) {
  const settings = await settingsMap(db);
  const base = consoleBase(auth, settings, request);

  if (path === '/admin/orders' && method === 'GET') {
    const q = cleanText(url.searchParams.get('q'), 100);
    const payment = cleanText(url.searchParams.get('payment'), 30);
    const fulfilment = cleanText(url.searchParams.get('fulfilment'), 30);
    const from = cleanText(url.searchParams.get('from'), 20);
    const to = cleanText(url.searchParams.get('to'), 20);
    const where = [];
    const params = [];
    if (q) {
      where.push('(o.reference LIKE ? OR o.email LIKE ? OR o.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (payment) {
      where.push('o.payment_status = ?');
      params.push(payment);
    }
    if (fulfilment) {
      where.push('o.fulfilment_status = ?');
      params.push(fulfilment);
    }
    if (from) {
      where.push('o.placed_at >= ?');
      params.push(`${from}T00:00:00.000Z`);
    }
    if (to) {
      where.push('o.placed_at <= ?');
      params.push(`${to}T23:59:59.999Z`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRow = await one(db, `SELECT COUNT(*) AS c FROM orders o ${clause}`, ...params);
    const total = Number(countRow.c || 0);
    const perPage = 25;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const current = Math.min(pages, Math.max(1, intOr(url.searchParams.get('page'), 1)));
    const orders = await all(
      db,
      `SELECT o.* FROM orders o ${clause} ORDER BY o.placed_at DESC LIMIT ? OFFSET ?`,
      ...params,
      perPage,
      (current - 1) * perPage,
    );
    return html(ordersPage({ ...base, orders, filters: { q, payment, fulfilment, from, to }, total, page: current, pages }), 200);
  }

  if (path.startsWith('/admin/orders/') && path.endsWith('/fulfilment') && method === 'POST') {
    if (!can(auth.user, 'orders.write')) return forbidden();
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const order = await loadOrder(db, path.split('/')[3]);
    if (!order) return redirect('/admin/orders?error=Order%20not%20found');
    const next = FULFILMENT_STATUSES.includes(form.get('fulfilment_status')) ? form.get('fulfilment_status') : order.fulfilment_status;
    const tracking = cleanText(form.get('tracking_number'), 80) || order.tracking_number;
    const provider = cleanText(form.get('shipping_provider'), 80) || order.shipping_provider;
    await run(
      db,
      'UPDATE orders SET fulfilment_status = ?, tracking_number = ?, shipping_provider = ?, updated_at = ? WHERE id = ?',
      next,
      tracking,
      provider,
      nowIso(),
      order.id,
    );
    if (next === 'shipped') {
      await run(
        db,
        'INSERT INTO shipping_records (id, order_id, provider, tracking_number, dispatched_at, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        uid('shp_'),
        order.id,
        provider,
        tracking,
        nowIso(),
        null,
        nowIso(),
      );
      await queueEmail(db, {
        to: order.email,
        templateKey: 'dispatch_notification',
        orderId: order.id,
        data: { name: order.name, reference: order.reference, carrier: provider || 'carrier to be confirmed', tracking: tracking || 'tracking to follow' },
      });
      await queueEmail(db, {
        to: order.email,
        templateKey: 'tracking_information',
        orderId: order.id,
        data: { name: order.name, reference: order.reference, carrier: provider || '', tracking: tracking || '' },
      });
    }
    if (next === 'cancelled') {
      await releaseOrderReservations(db, order.id, 'Order cancelled by founder');
      if (['paid', 'partially_refunded'].includes(order.payment_status)) {
        await run(
          db,
          `UPDATE orders SET internal_notes = COALESCE(internal_notes,'') || ?, updated_at = ? WHERE id = ?`,
          `\n[${nowIso()}] Cancelled after payment — refund required.`,
          nowIso(),
          order.id,
        );
      }
      await queueEmail(db, { to: order.email, templateKey: 'cancellation', orderId: order.id, data: { name: order.name, reference: order.reference } });
    }
    await audit(db, {
      userId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'order.fulfilment_updated',
      entityType: 'order',
      entityId: order.id,
      details: { from: order.fulfilment_status, to: next, tracking, provider },
      ip: clientIp(request),
    });
    return redirect(`/admin/orders/${order.id}?notice=Fulfilment%20updated`);
  }

  if (path.startsWith('/admin/orders/') && path.endsWith('/refund') && method === 'POST') {
    if (!can(auth.user, 'refunds.issue')) return forbidden();
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const order = await loadOrder(db, path.split('/')[3]);
    if (!order) return redirect('/admin/orders?error=Order%20not%20found');
    const amount = parseDollars(form.get('amount'));
    if (!amount) return redirect(`/admin/orders/${order.id}?error=Enter%20a%20valid%20refund%20amount.`);
    const result = await refundOrder(db, env, {
      orderId: order.id,
      amountCents: amount,
      reason: cleanText(form.get('reason'), 300),
      restock: form.get('restock') === '1',
      userId: auth.user.id,
      actorEmail: auth.user.email,
    });
    if (!result.ok) return redirect(`/admin/orders/${order.id}?error=${encodeURIComponent(result.error)}`);
    return redirect(`/admin/orders/${order.id}?notice=Refund%20recorded`);
  }

  if (path.startsWith('/admin/orders/') && path.endsWith('/notes') && method === 'POST') {
    if (!can(auth.user, 'orders.write')) return forbidden();
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const order = await loadOrder(db, path.split('/')[3]);
    if (!order) return redirect('/admin/orders?error=Order%20not%20found');
    const note = cleanText(form.get('note'), 2000);
    if (!note) return redirect(`/admin/orders/${order.id}?error=Note%20cannot%20be%20empty.`);
    await run(
      db,
      'INSERT INTO order_notes (id, order_id, user_id, actor_email, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      uid('note_'),
      order.id,
      auth.user.id,
      auth.user.email,
      note,
      nowIso(),
    );
    await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'order.note_added', entityType: 'order', entityId: order.id, ip: clientIp(request) });
    return redirect(`/admin/orders/${order.id}?notice=Note%20added`);
  }

  if (path.startsWith('/admin/orders/') && method === 'GET' && !path.endsWith('.csv')) {
    const order = await loadOrder(db, path.split('/')[3]);
    if (!order) return redirect('/admin/orders?error=Order%20not%20found');
    const items = await all(db, 'SELECT * FROM order_items WHERE order_id = ?', order.id);
    const payments = await all(db, 'SELECT * FROM payments WHERE order_id = ? ORDER BY created_at', order.id);
    const refunds = await all(db, 'SELECT * FROM refunds WHERE order_id = ? ORDER BY created_at', order.id);
    const notes = await all(db, 'SELECT * FROM order_notes WHERE order_id = ? ORDER BY created_at DESC', order.id);
    const providers = await enabledProviders(db, env, settings);
    return html(orderDetailPage({ ...base, order, items, payments, refunds, notes, providers }), 200);
  }

  if (path === '/admin/customers') {
    const customers = await all(
      db,
      `SELECT c.*, COUNT(o.id) AS order_count,
        COALESCE(SUM(CASE WHEN o.payment_status IN ('paid','partially_refunded') THEN o.total_cents ELSE 0 END),0) AS spent_cents
       FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
       GROUP BY c.id ORDER BY c.created_at DESC LIMIT 500`,
    );
    const waitlist = await all(
      db,
      `SELECT w.*, p.name AS product_name FROM waitlist w LEFT JOIN products p ON p.id = w.product_id ORDER BY w.created_at DESC LIMIT 500`,
    );
    return html(customersPage({ ...base, customers, waitlist }), 200);
  }

  if (path === '/admin/preorders') {
    const batches = await all(
      db,
      `SELECT bi.*, p.name AS product_name, pb.reference, pb.status, pb.estimated_completion
       FROM batch_items bi JOIN products p ON p.id = bi.product_id JOIN production_batches pb ON pb.id = bi.batch_id
       ORDER BY pb.created_at DESC`,
    );
    const preorderOrders = await all(
      db,
      `SELECT o.id AS order_id, o.reference, o.name, o.placed_at, o.payment_status, o.fulfilment_status,
              p.name AS product_name, oi.qty
       FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
       WHERE oi.fulfilment_model = 'preorder' ORDER BY o.placed_at DESC LIMIT 200`,
    );
    const waitlist = await all(
      db,
      `SELECT w.*, p.name AS product_name FROM waitlist w LEFT JOIN products p ON p.id = w.product_id ORDER BY w.created_at DESC LIMIT 300`,
    );
    return html(preordersPage({ ...base, waitlist, batches, preorderOrders, settings }), 200);
  }

  if (path.startsWith('/admin/preorders/waitlist/') && path.endsWith('/notify') && method === 'POST') {
    if (!can(auth.user, 'orders.write')) return forbidden();
    const { ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const id = path.split('/')[4];
    const entry = await one(db, 'SELECT * FROM waitlist WHERE id = ?', id);
    if (!entry) return redirect('/admin/preorders?error=Registration%20not%20found');
    const product = entry.product_id ? await one(db, 'SELECT * FROM products WHERE id = ?', entry.product_id) : null;
    await run(db, `UPDATE waitlist SET status = 'notified', notified_at = ? WHERE id = ?`, nowIso(), id);
    await queueEmail(db, {
      to: entry.email,
      templateKey: 'restock_alert',
      data: { name: entry.name, product: product ? product.name : 'the DUSK & DEW collection' },
    });
    await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'waitlist.notified', entityType: 'waitlist', entityId: id, ip: clientIp(request) });
    return redirect('/admin/preorders?notice=Registration%20marked%20notified');
  }

  if (path === '/admin/batches') {
    if (method === 'POST') {
      if (!can(auth.user, 'batches.write')) return forbidden();
      const { form, ok } = await postForm(request, auth);
      if (!ok) return forbidden();
      const reference = cleanText(form.get('reference'), 60);
      const productId = cleanText(form.get('product_id'), 40);
      const allocated = intOr(form.get('allocated_qty'), 0);
      if (!reference || !productId || allocated <= 0) return redirect('/admin/batches?error=Reference%2C%20product%20and%20a%20positive%20allocation%20are%20required.');
      if (await one(db, 'SELECT id FROM production_batches WHERE reference = ?', reference)) {
        return redirect('/admin/batches?error=That%20batch%20reference%20already%20exists.');
      }
      const batchId = uid('bat_');
      const now = nowIso();
      await db.batch([
        db.prepare(
          `INSERT INTO production_batches (id, reference, manufacturer, notes, status, estimated_completion, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?)`,
        ).bind(batchId, reference, cleanText(form.get('manufacturer'), 160) || null, cleanText(form.get('notes'), 2000) || null, cleanText(form.get('estimated_completion'), 20) || null, auth.user.email, now, now),
        db.prepare(
          `INSERT INTO batch_items (id, batch_id, product_id, allocated_qty, preorder_qty, preorder_holds, received_qty, unit_cost_cents)
           VALUES (?, ?, ?, ?, 0, 0, 0, ?)`,
        ).bind(uid('bit_'), batchId, productId, allocated, parseDollars(form.get('unit_cost'))),
      ]);
      await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'batch.created', entityType: 'batch', entityId: batchId, details: { reference, allocated }, ip: clientIp(request) });
      return redirect(`/admin/batches/${batchId}?notice=Batch%20created`);
    }
    const batches = await all(
      db,
      `SELECT b.*, COUNT(bi.id) AS product_count, COALESCE(SUM(bi.allocated_qty),0) AS allocated_total,
              COALESCE(SUM(bi.preorder_qty),0) AS preorder_total
       FROM production_batches b LEFT JOIN batch_items bi ON bi.batch_id = b.id
       GROUP BY b.id ORDER BY b.created_at DESC`,
    );
    const products = await all(db, `SELECT id, name, sku FROM products WHERE status <> 'discontinued' ORDER BY name`);
    return html(batchesPage({ ...base, batches, products }), 200);
  }

  if (path.startsWith('/admin/batches/') && path.endsWith('/receive') && method === 'POST') {
    if (!can(auth.user, 'batches.write')) return forbidden();
    const { ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const id = path.split('/')[3];
    try {
      await receiveBatch(db, id, { userId: auth.user.id });
    } catch (err) {
      return redirect(`/admin/batches/${id}?error=${encodeURIComponent(err.message)}`);
    }
    await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'batch.received', entityType: 'batch', entityId: id, ip: clientIp(request) });
    return redirect(`/admin/batches/${id}?notice=Batch%20received%20into%20inventory`);
  }

  if (path.startsWith('/admin/batches/') && path.endsWith('/items') && method === 'POST') {
    if (!can(auth.user, 'batches.write')) return forbidden();
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const id = path.split('/')[3];
    const productId = cleanText(form.get('product_id'), 40);
    const allocated = intOr(form.get('allocated_qty'), 0);
    if (!productId || allocated <= 0) return redirect(`/admin/batches/${id}?error=Choose%20a%20product%20and%20allocation.`);
    const existing = await one(db, 'SELECT * FROM batch_items WHERE batch_id = ? AND product_id = ?', id, productId);
    if (existing) {
      await run(db, 'UPDATE batch_items SET allocated_qty = allocated_qty + ?, unit_cost_cents = COALESCE(?, unit_cost_cents) WHERE id = ?', allocated, parseDollars(form.get('unit_cost')), existing.id);
    } else {
      await run(
        db,
        `INSERT INTO batch_items (id, batch_id, product_id, allocated_qty, preorder_qty, preorder_holds, received_qty, unit_cost_cents)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?)`,
        uid('bit_'),
        id,
        productId,
        allocated,
        parseDollars(form.get('unit_cost')),
      );
    }
    await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'batch.item_added', entityType: 'batch', entityId: id, details: { productId, allocated }, ip: clientIp(request) });
    return redirect(`/admin/batches/${id}?notice=Product%20assigned%20to%20batch`);
  }

  if (path.startsWith('/admin/batches/') && method === 'POST') {
    if (!can(auth.user, 'batches.write')) return forbidden();
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const id = path.split('/')[3];
    const batch = await one(db, 'SELECT * FROM production_batches WHERE id = ?', id);
    if (!batch) return redirect('/admin/batches?error=Batch%20not%20found');
    if (batch.status === 'received') return redirect(`/admin/batches/${id}?error=Received%20batches%20cannot%20be%20edited.`);
    const status = BATCH_STATUSES.filter((s) => s !== 'received').includes(form.get('status')) ? form.get('status') : batch.status;
    await run(
      db,
      `UPDATE production_batches SET reference = ?, manufacturer = ?, status = ?, start_date = ?, estimated_completion = ?,
        actual_completion = ?, quality_approved = ?, notes = ?, updated_at = ? WHERE id = ?`,
      cleanText(form.get('reference'), 60) || batch.reference,
      cleanText(form.get('manufacturer'), 160) || null,
      status,
      cleanText(form.get('start_date'), 20) || null,
      cleanText(form.get('estimated_completion'), 20) || null,
      cleanText(form.get('actual_completion'), 20) || null,
      form.get('quality_approved') === '1' ? 1 : 0,
      cleanText(form.get('notes'), 2000) || null,
      nowIso(),
      id,
    );
    await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'batch.updated', entityType: 'batch', entityId: id, details: { status }, ip: clientIp(request) });
    return redirect(`/admin/batches/${id}?notice=Batch%20updated`);
  }

  if (path.startsWith('/admin/batches/') && method === 'GET') {
    const batch = await one(db, 'SELECT * FROM production_batches WHERE id = ?', path.split('/')[3]);
    if (!batch) return redirect('/admin/batches?error=Batch%20not%20found');
    const items = await all(
      db,
      `SELECT bi.*, p.name AS product_name, p.sku FROM batch_items bi JOIN products p ON p.id = bi.product_id
       WHERE bi.batch_id = ? ORDER BY p.name`,
      batch.id,
    );
    const products = await all(db, `SELECT id, name, sku FROM products WHERE status <> 'discontinued' ORDER BY name`);
    return html(batchDetailPage({ ...base, batch, items, products }), 200);
  }

  return null;
}
