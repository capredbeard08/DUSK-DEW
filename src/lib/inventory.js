/**
 * Inventory engine.
 *
 * Rules enforced here:
 *  - available = physical - reserved
 *  - reservations are created atomically with a guarded UPDATE (no overselling)
 *  - stock is only deducted after a *verified* payment, exactly once per order
 *  - every change writes an append-only inventory movement
 *  - preorder quantities live on production batches, never in physical stock
 */
import { all, nowIso, one, run, stmt, uid } from './db.js';

export const RESERVATION_TTL_MINUTES = 30;

export function availableFor(inv) {
  if (!inv) return 0;
  return Math.max(0, Number(inv.physical_stock) - Number(inv.reserved_stock));
}

export function stockBadge(product, inv, settings = {}) {
  if (product.manual_unavailable || product.status === 'temporarily_unavailable') {
    return { key: 'unavailable', label: 'Temporarily unavailable', purchasable: false };
  }
  if (product.status === 'discontinued') {
    return { key: 'discontinued', label: 'Discontinued', purchasable: false };
  }
  if (product.status === 'draft') {
    return { key: 'draft', label: 'Not yet available', purchasable: false };
  }
  if (product.fulfilment_model === 'preorder') {
    if (product.preorder_enabled && settings.preorders_enabled === '1') {
      return { key: 'preorder', label: 'Preorder — next batch', purchasable: true, preorder: true };
    }
    return { key: 'waitlist', label: 'Waitlist — preorders not open', purchasable: false, waitlist: true };
  }
  const avail = availableFor(inv);
  if (avail <= 0) {
    return { key: 'out_of_stock', label: 'Out of stock', purchasable: false, waitlist: true };
  }
  if (avail <= Number(product.low_stock_threshold || 0)) {
    return { key: 'low_stock', label: `Low stock — ${avail} left`, purchasable: true, low: true };
  }
  return { key: 'in_stock', label: 'In stock', purchasable: true };
}

/** Load a product with inventory and category for display. */
export async function productWithStock(db, slugOrId) {
  return one(
    db,
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
            COALESCE(i.physical_stock, 0) AS physical_stock,
            COALESCE(i.reserved_stock, 0) AS reserved_stock,
            COALESCE(i.units_sold, 0) AS units_sold,
            i.last_restock_at
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN inventory i ON i.product_id = p.id
     WHERE p.slug = ? OR p.id = ? LIMIT 1`,
    slugOrId,
    slugOrId,
  );
}

export async function inventoryRow(db, productId) {
  return one(db, 'SELECT * FROM inventory WHERE product_id = ?', productId);
}

async function recordMovement(db, { productId, kind, qtyDelta, physicalAfter, reservedAfter, reason, refType, refId, userId }) {
  return stmt(
    db,
    `INSERT INTO inventory_movements
      (id, product_id, kind, qty_delta, physical_after, reserved_after, reason, reference_type, reference_id, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    uid('mov_'),
    productId,
    kind,
    qtyDelta,
    physicalAfter,
    reservedAfter,
    reason || null,
    refType || null,
    refId || null,
    userId || null,
    nowIso(),
  );
}

/**
 * Reserve stock for every item of an order, atomically.
 * Returns { ok, error?, failedProductId? }.
 */
export async function reserveOrderStock(db, { orderId, items, ttlMinutes = RESERVATION_TTL_MINUTES, userId = null }) {
  const inventoryItems = items.filter((i) => i.fulfilmentModel !== 'preorder');
  const preorderItems = items.filter((i) => i.fulfilmentModel === 'preorder');
  const now = nowIso();
  const expires = new Date(Date.now() + ttlMinutes * 60000).toISOString();
  const reserved = [];

  for (const item of inventoryItems) {
    const res = await db
      .prepare(
        `UPDATE inventory SET reserved_stock = reserved_stock + ?, updated_at = ?
         WHERE product_id = ? AND (physical_stock - reserved_stock) >= ?`,
      )
      .bind(item.qty, now, item.productId, item.qty)
      .run();
    if (!res.meta || res.meta.changes !== 1) {
      await releaseStockRows(db, reserved);
      return { ok: false, error: 'insufficient_stock', failedProductId: item.productId };
    }
    reserved.push({ ...item, reservationId: uid('rsv_') });
  }

  const heldPreorders = [];
  for (const item of preorderItems) {
    if (!item.batchItemId) {
      await releaseStockRows(db, reserved);
      return { ok: false, error: 'preorder_unavailable', failedProductId: item.productId };
    }
    const res = await db
      .prepare(
        `UPDATE batch_items SET preorder_holds = preorder_holds + ?
         WHERE id = ? AND (allocated_qty - preorder_qty - preorder_holds) >= ?`,
      )
      .bind(item.qty, item.batchItemId, item.qty)
      .run();
    if (!res.meta || res.meta.changes !== 1) {
      await releaseStockRows(db, reserved);
      await releasePreorderHolds(db, heldPreorders);
      return { ok: false, error: 'preorder_capacity_reached', failedProductId: item.productId };
    }
    heldPreorders.push({ batchItemId: item.batchItemId, qty: item.qty });
  }

  const statements = [];
  for (const item of reserved) {
    statements.push(
      stmt(
        db,
        `INSERT INTO inventory_reservations (id, order_id, order_item_id, product_id, qty, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
        item.reservationId,
        orderId,
        item.orderItemId,
        item.productId,
        item.qty,
        expires,
        now,
      ),
    );
  }
  if (statements.length) await db.batch(statements);
  return { ok: true, expiresAt: expires, reservations: reserved };
}

async function releaseStockRows(db, rows) {
  if (!rows.length) return;
  await db.batch(
    rows.map((r) =>
      stmt(db, 'UPDATE inventory SET reserved_stock = reserved_stock - ?, updated_at = ? WHERE product_id = ?', r.qty, nowIso(), r.productId),
    ),
  );
}

async function releasePreorderHolds(db, rows) {
  if (!rows.length) return;
  await db.batch(
    rows.map((r) => stmt(db, 'UPDATE batch_items SET preorder_holds = preorder_holds - ? WHERE id = ?', r.qty, r.batchItemId)),
  );
}

/**
 * Convert reservations into a completed sale. Called only after a verified payment.
 * Idempotency is enforced by the caller (payments.status === 'succeeded').
 */
export async function commitOrderInventory(db, orderId, { userId = null } = {}) {
  const items = await all(
    db,
    `SELECT oi.*, r.id AS reservation_id, r.qty AS reserved_qty
     FROM order_items oi
     LEFT JOIN inventory_reservations r ON r.order_item_id = oi.id AND r.status = 'active'
     WHERE oi.order_id = ?`,
    orderId,
  );
  if (!items.length) return { ok: false, error: 'no_items' };

  const now = nowIso();
  const applied = [];
  const failures = [];

  for (const item of items) {
    if (item.fulfilment_model === 'preorder') continue;
    if (!item.reservation_id) {
      failures.push(item.product_id);
      continue;
    }
    const res = await db
      .prepare(
        `UPDATE inventory SET physical_stock = physical_stock - ?, reserved_stock = reserved_stock - ?,
           units_sold = units_sold + ?, updated_at = ?
         WHERE product_id = ? AND physical_stock >= ? AND reserved_stock >= ?`,
      )
      .bind(item.qty, item.qty, item.qty, now, item.product_id, item.qty, item.qty)
      .run();
    if (!res.meta || res.meta.changes !== 1) {
      failures.push(item.product_id);
    } else {
      applied.push(item);
    }
  }

  if (failures.length) {
    // Compensate any partial application so stock is never silently wrong.
    for (const item of applied) {
      await run(
        db,
        `UPDATE inventory SET physical_stock = physical_stock + ?, reserved_stock = reserved_stock + ?,
           units_sold = units_sold - ?, updated_at = ?
         WHERE product_id = ?`,
        item.qty,
        item.qty,
        item.qty,
        now,
        item.product_id,
      );
    }
    return { ok: false, error: 'stock_unavailable', failedProductId: failures[0] };
  }

  const statements = [];
  for (const item of applied) {
    const inv = await inventoryRow(db, item.product_id);
    statements.push(
      stmt(
        db,
        `UPDATE inventory_reservations SET status = 'committed' WHERE id = ?`,
        item.reservation_id,
      ),
      await recordMovement(db, {
        productId: item.product_id,
        kind: 'sale',
        qtyDelta: -item.qty,
        physicalAfter: inv.physical_stock,
        reservedAfter: inv.reserved_stock,
        reason: `Order ${orderId} payment verified`,
        refType: 'order',
        refId: orderId,
        userId,
      }),
    );
  }

  for (const item of items.filter((i) => i.fulfilment_model === 'preorder' && i.batch_item_id)) {
    statements.push(
      stmt(
        db,
        `UPDATE batch_items SET preorder_holds = preorder_holds - ?, preorder_qty = preorder_qty + ?
         WHERE id = ? AND preorder_holds >= ?`,
        item.qty,
        item.qty,
        item.batch_item_id,
        item.qty,
      ),
    );
  }

  if (statements.length) await db.batch(statements);
  // Availability must reflect the new stock immediately (out of stock / active).
  for (const productId of new Set(applied.map((item) => item.product_id))) {
    await syncProductAvailability(db, productId);
  }
  return { ok: true, applied: applied.length };
}

/** Release active reservations for an order (failed/expired/cancelled checkout). */
export async function releaseOrderReservations(db, orderId, reason = 'released') {
  const rows = await all(
    db,
    `SELECT * FROM inventory_reservations WHERE order_id = ? AND status = 'active'`,
    orderId,
  );
  if (!rows.length) return 0;
  const now = nowIso();
  for (const row of rows) {
    await run(
      db,
      `UPDATE inventory SET reserved_stock = reserved_stock - ?, updated_at = ?
       WHERE product_id = ? AND reserved_stock >= ?`,
      row.qty,
      now,
      row.product_id,
      row.qty,
    );
    await run(db, `UPDATE inventory_reservations SET status = 'released' WHERE id = ?`, row.id);
    const inv = await inventoryRow(db, row.product_id);
    if (inv) {
      await recordMovement(db, {
        productId: row.product_id,
        kind: 'release',
        qtyDelta: 0,
        physicalAfter: inv.physical_stock,
        reservedAfter: inv.reserved_stock,
        reason,
        refType: 'order',
        refId: orderId,
      });
    }
  }
  const preorderRows = await all(db, 'SELECT batch_item_id, qty FROM order_items WHERE order_id = ? AND fulfilment_model = ?', orderId, 'preorder');
  if (preorderRows.length) {
    await db.batch(
      preorderRows
        .filter((r) => r.batch_item_id)
        .map((r) => stmt(db, 'UPDATE batch_items SET preorder_holds = preorder_holds - ? WHERE id = ? AND preorder_holds >= ?', r.qty, r.batch_item_id, r.qty)),
    );
  }
  return rows.length;
}

/** Release reservations whose checkout window has expired. */
export async function expireReservations(db) {
  const expired = await all(
    db,
    `SELECT * FROM inventory_reservations WHERE status = 'active' AND expires_at < ?`,
    nowIso(),
  );
  const releaseMovements = [];
  for (const row of expired) {
    await run(
      db,
      `UPDATE inventory_reservations SET status = 'released' WHERE id = ? AND status = 'active'`,
      row.id,
    );
    await run(
      db,
      `UPDATE inventory SET reserved_stock = reserved_stock - ?, updated_at = ?
       WHERE product_id = ? AND reserved_stock >= ?`,
      row.qty,
      nowIso(),
      row.product_id,
      row.qty,
    );
    const inv = await inventoryRow(db, row.product_id);
    if (inv) {
      releaseMovements.push(
        await recordMovement(db, {
          productId: row.product_id,
          kind: 'release',
          qtyDelta: 0,
          physicalAfter: inv.physical_stock,
          reservedAfter: inv.reserved_stock,
          reason: 'Reservation expired and released',
          refType: 'order',
          refId: row.order_id,
        }),
      );
    }
  }
  if (releaseMovements.length) await db.batch(releaseMovements);
  const orderIds = [...new Set(expired.map((r) => r.order_id))];
  for (const orderId of orderIds) {
    const stillActive = await one(
      db,
      `SELECT COUNT(*) AS c FROM inventory_reservations WHERE order_id = ? AND status = 'active'`,
      orderId,
    );
    if (!stillActive || Number(stillActive.c) === 0) {
      await run(
        db,
        `UPDATE orders SET fulfilment_status = 'cancelled', updated_at = ?
         WHERE id = ? AND payment_status IN ('unpaid','pending','failed')`,
        nowIso(),
        orderId,
      );
      await releaseOrderReservations(db, orderId, 'Reservation expired');
    }
  }
  return expired.length;
}

export async function restockProduct(db, { productId, qty, supplier, batchRef, unitCostCents, restockDate, notes, userId }) {
  const quantity = Number(qty);
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Restock quantity must be a positive whole number');
  const inv = await inventoryRow(db, productId);
  if (!inv) throw new Error('Inventory record not found');
  const now = nowIso();
  const restockId = uid('rst_');
  const newPhysical = Number(inv.physical_stock) + quantity;
  await db.batch([
    stmt(
      db,
      `UPDATE inventory SET physical_stock = physical_stock + ?, last_restock_at = ?, updated_at = ? WHERE product_id = ?`,
      quantity,
      restockDate || now,
      now,
      productId,
    ),
    stmt(
      db,
      `INSERT INTO restocks (id, product_id, qty, supplier, batch_ref, unit_cost_cents, restock_date, notes, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      restockId,
      productId,
      quantity,
      supplier || null,
      batchRef || null,
      unitCostCents ?? null,
      restockDate || now.slice(0, 10),
      notes || null,
      userId || null,
      now,
    ),
    await recordMovement(db, {
      productId,
      kind: 'restock',
      qtyDelta: quantity,
      physicalAfter: newPhysical,
      reservedAfter: inv.reserved_stock,
      reason: supplier ? `Restock — ${supplier}` : 'Restock',
      refType: 'restock',
      refId: restockId,
      userId,
    }),
    stmt(db, 'UPDATE products SET updated_at = ? WHERE id = ?', now, productId),
  ]);
  await syncProductAvailability(db, productId);
  return { physicalStock: newPhysical, restockId };
}

export async function adjustStock(db, { productId, qtyDelta, category, reason, notes, userId }) {
  const delta = Number(qtyDelta);
  if (!Number.isInteger(delta) || delta === 0) throw new Error('Adjustment must be a non-zero whole number');
  if (!reason || reason.trim().length < 3) throw new Error('A reason is required for every stock adjustment');
  const inv = await inventoryRow(db, productId);
  if (!inv) throw new Error('Inventory record not found');
  if (Number(inv.physical_stock) + delta < Number(inv.reserved_stock)) {
    throw new Error('Adjustment would leave less physical stock than reserved stock');
  }
  if (Number(inv.physical_stock) + delta < 0) throw new Error('Adjustment would make physical stock negative');
  const now = nowIso();
  const newPhysical = Number(inv.physical_stock) + delta;
  await db.batch([
    stmt(db, 'UPDATE inventory SET physical_stock = physical_stock + ?, updated_at = ? WHERE product_id = ?', delta, now, productId),
    stmt(
      db,
      `INSERT INTO stock_adjustments (id, product_id, qty_delta, category, reason, notes, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      uid('adj_'),
      productId,
      delta,
      category || 'correction',
      reason.trim(),
      notes || null,
      userId || null,
      now,
    ),
    await recordMovement(db, {
      productId,
      kind: 'adjustment',
      qtyDelta: delta,
      physicalAfter: newPhysical,
      reservedAfter: inv.reserved_stock,
      reason: `${category || 'correction'}: ${reason.trim()}`,
      refType: 'adjustment',
      refId: null,
      userId,
    }),
  ]);
  await syncProductAvailability(db, productId);
  return { physicalStock: newPhysical };
}

/** Add confirmed received batch units to physical inventory (exactly once). */
export async function receiveBatch(db, batchId, { userId = null } = {}) {
  const batch = await one(db, 'SELECT * FROM production_batches WHERE id = ?', batchId);
  if (!batch) throw new Error('Batch not found');
  if (batch.status === 'received') throw new Error('This batch has already been received into inventory');
  if (batch.status === 'cancelled') throw new Error('Cancelled batches cannot be received');
  const items = await all(db, 'SELECT * FROM batch_items WHERE batch_id = ?', batchId);
  if (!items.length) throw new Error('Batch has no products assigned');
  const now = nowIso();
  for (const item of items) {
    const qty = Number(item.received_qty || item.allocated_qty || 0);
    if (qty <= 0) continue;
    let inv = await inventoryRow(db, item.product_id);
    if (!inv) {
      await run(
        db,
        'INSERT INTO inventory (product_id, physical_stock, reserved_stock, units_sold, updated_at) VALUES (?, 0, 0, 0, ?)',
        item.product_id,
        now,
      );
      inv = await inventoryRow(db, item.product_id);
    }
    await db.batch([
      stmt(db, 'UPDATE inventory SET physical_stock = physical_stock + ?, last_restock_at = ?, updated_at = ? WHERE product_id = ?', qty, now, now, item.product_id),
      stmt(
        db,
        `INSERT INTO restocks (id, product_id, qty, supplier, batch_ref, unit_cost_cents, restock_date, notes, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uid('rst_'),
        item.product_id,
        qty,
        batch.manufacturer || null,
        batch.reference,
        item.unit_cost_cents ?? null,
        now.slice(0, 10),
        `Production batch ${batch.reference} received`,
        userId || null,
        now,
      ),
      await recordMovement(db, {
        productId: item.product_id,
        kind: 'batch_receipt',
        qtyDelta: qty,
        physicalAfter: Number(inv.physical_stock) + qty,
        reservedAfter: inv.reserved_stock,
        reason: `Production batch ${batch.reference} received into inventory`,
        refType: 'batch',
        refId: batchId,
        userId,
      }),
    ]);
    await syncProductAvailability(db, item.product_id);
  }
  await run(
    db,
    `UPDATE production_batches SET status = 'received', received_at = ?, received_by = ?, actual_completion = COALESCE(actual_completion, ?), updated_at = ? WHERE id = ?`,
    now,
    userId || null,
    now,
    now,
    batchId,
  );
  return { ok: true };
}

/**
 * Keep product status aligned with stock. Manual overrides are respected:
 * we never force a manually unavailable or discontinued product back on sale.
 */
export async function syncProductAvailability(db, productId) {
  const row = await one(
    db,
    `SELECT p.status, p.manual_unavailable, p.fulfilment_model, i.physical_stock, i.reserved_stock
     FROM products p LEFT JOIN inventory i ON i.product_id = p.id WHERE p.id = ?`,
    productId,
  );
  if (!row) return;
  if (['draft', 'discontinued', 'temporarily_unavailable'].includes(row.status)) return;
  const available = Math.max(0, Number(row.physical_stock || 0) - Number(row.reserved_stock || 0));
  if (row.fulfilment_model === 'preorder') {
    const next = row.manual_unavailable ? 'temporarily_unavailable' : 'active';
    if (next !== row.status) await run(db, 'UPDATE products SET status = ?, updated_at = ? WHERE id = ?', next, nowIso(), productId);
    return;
  }
  const next = available <= 0 ? 'out_of_stock' : 'active';
  if (next !== row.status) {
    await run(db, 'UPDATE products SET status = ?, updated_at = ? WHERE id = ?', next, nowIso(), productId);
  }
}

export async function expireAndSync(db) {
  const released = await expireReservations(db);
  return released;
}
