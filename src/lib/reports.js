/** Dashboard and analytics aggregates. Read-only queries. */
import { all, one } from './db.js';

const PAID_STATES = `('paid','partially_refunded')`;

export async function dashboardData(db) {
  const [grossRow, pendingRow, refundRow, orderRows, customerRow, waitlistRow, productRows, inventoryRow, batchRow, lowStockRow, chartRows, recentOrders, activity] =
    await Promise.all([
      one(db, `SELECT COALESCE(SUM(amount_cents),0) AS total FROM payments WHERE status IN ('succeeded','partially_refunded','refunded')`),
      one(db, `SELECT COALESCE(SUM(total_cents),0) AS total, COUNT(*) AS c FROM orders WHERE payment_status IN ('unpaid','pending')`),
      one(db, `SELECT COALESCE(SUM(amount_cents),0) AS total FROM refunds WHERE status = 'succeeded'`),
      one(
        db,
        `SELECT COUNT(*) AS total,
          SUM(CASE WHEN placed_at >= ? THEN 1 ELSE 0 END) AS last30,
          SUM(CASE WHEN payment_status IN ${PAID_STATES} THEN 1 ELSE 0 END) AS paid,
          SUM(CASE WHEN payment_status IN ('unpaid','pending') THEN 1 ELSE 0 END) AS pending
         FROM orders`,
        new Date(Date.now() - 30 * 86400000).toISOString(),
      ),
      one(db, 'SELECT COUNT(*) AS total FROM customers'),
      one(db, 'SELECT COUNT(*) AS total FROM waitlist'),
      one(db, `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN status = 'out_of_stock' THEN 1 ELSE 0 END) AS out FROM products WHERE status <> 'discontinued'`),
      one(db, 'SELECT COALESCE(SUM(physical_stock),0) AS physical, COALESCE(SUM(reserved_stock),0) AS reserved FROM inventory'),
      one(db, `SELECT COUNT(*) AS c FROM production_batches WHERE status NOT IN ('received','cancelled')`),
      one(
        db,
        `SELECT COUNT(*) AS c FROM products p JOIN inventory i ON i.product_id = p.id
         WHERE p.status = 'active' AND (i.physical_stock - i.reserved_stock) <= p.low_stock_threshold`,
      ),
      all(
        db,
        `SELECT substr(verified_at, 1, 10) AS day, SUM(amount_cents) AS total FROM payments
         WHERE verified_at >= ? AND status IN ('succeeded','partially_refunded','refunded')
         GROUP BY day`,
        new Date(Date.now() - 13 * 86400000).toISOString(),
      ),
      all(db, 'SELECT * FROM orders ORDER BY placed_at DESC LIMIT 6'),
      all(db, 'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 8'),
    ]);

  const paidOrders = Number(orderRows.paid || 0);
  const physical = Number(inventoryRow.physical || 0);
  const reserved = Number(inventoryRow.reserved || 0);
  const revenuePaid = Number(grossRow.total || 0);
  const preorderRow = await one(db, 'SELECT COALESCE(SUM(preorder_qty),0) AS c FROM batch_items');

  const byDay = new Map(chartRows.map((r) => [r.day, Number(r.total)]));
  const chart = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    chart.push({ date: key, label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }), total: byDay.get(key) || 0 });
  }

  return {
    summary: {
      revenuePaid,
      pendingValue: Number(pendingRow.total || 0),
      refunds: Number(refundRow.total || 0),
      ordersCount: Number(orderRows.total || 0),
      orders30: Number(orderRows.last30 || 0),
      paidOrders,
      pendingOrders: Number(orderRows.pending || 0),
      aov: paidOrders ? Math.round(revenuePaid / paidOrders) : 0,
      customers: Number(customerRow.total || 0),
      waitlist: Number(waitlistRow.total || 0),
      activeProducts: Number(productRows.active || 0),
      totalProducts: Number(productRows.total || 0),
      inventoryUnits: physical,
      availableUnits: Math.max(0, physical - reserved),
      lowStockCount: Number(lowStockRow.c || 0),
      outOfStockCount: Number(productRows.out || 0),
      activeBatches: Number(batchRow.c || 0),
      preorderUnits: Number(preorderRow.c || 0),
    },
    recentOrders,
    activity,
    chart,
    lowStock: await all(
      db,
      `SELECT p.id AS product_id, p.name, p.low_stock_threshold, (i.physical_stock - i.reserved_stock) AS available
       FROM products p JOIN inventory i ON i.product_id = p.id
       WHERE p.status = 'active' AND (i.physical_stock - i.reserved_stock) <= p.low_stock_threshold
       ORDER BY available ASC LIMIT 6`,
    ),
  };
}

export async function inventorySummary(db) {
  const row = await one(
    db,
    `SELECT COALESCE(SUM(physical_stock),0) AS physical, COALESCE(SUM(reserved_stock),0) AS reserved,
            COALESCE(SUM(units_sold),0) AS sold FROM inventory`,
  );
  const low = await one(
    db,
    `SELECT COUNT(*) AS c FROM products p JOIN inventory i ON i.product_id = p.id
     WHERE p.status = 'active' AND (i.physical_stock - i.reserved_stock) <= p.low_stock_threshold AND (i.physical_stock - i.reserved_stock) > 0`,
  );
  const out = await one(
    db,
    `SELECT COUNT(*) AS c FROM products p JOIN inventory i ON i.product_id = p.id
     WHERE (i.physical_stock - i.reserved_stock) <= 0 AND p.status <> 'draft'`,
  );
  const value = await one(
    db,
    `SELECT COALESCE(SUM(i.physical_stock * COALESCE(p.cost_cents,0)),0) AS v
     FROM inventory i JOIN products p ON p.id = i.product_id`,
  );
  const reservations = await one(db, `SELECT COUNT(*) AS c FROM inventory_reservations WHERE status = 'active'`);
  return {
    physical: Number(row.physical || 0),
    reserved: Number(row.reserved || 0),
    available: Math.max(0, Number(row.physical || 0) - Number(row.reserved || 0)),
    sold: Number(row.sold || 0),
    low: Number(low.c || 0),
    out: Number(out.c || 0),
    value: Number(value.v || 0),
    activeReservations: Number(reservations.c || 0),
  };
}

export async function analyticsData(db, from, to) {
  const fromIso = `${from}T00:00:00.000Z`;
  const toIso = `${to}T23:59:59.999Z`;

  const gross = await one(
    db,
    `SELECT COALESCE(SUM(amount_cents),0) AS t FROM payments WHERE verified_at BETWEEN ? AND ? AND status IN ('succeeded','partially_refunded','refunded')`,
    fromIso,
    toIso,
  );
  const refunds = await one(
    db,
    `SELECT COALESCE(SUM(amount_cents),0) AS t FROM refunds WHERE created_at BETWEEN ? AND ? AND status = 'succeeded'`,
    fromIso,
    toIso,
  );
  const orders = await one(
    db,
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN payment_status IN ${PAID_STATES} THEN 1 ELSE 0 END) AS paid
     FROM orders WHERE placed_at BETWEEN ? AND ?`,
    fromIso,
    toIso,
  );
  const pending = await one(
    db,
    `SELECT COALESCE(SUM(total_cents),0) AS t FROM orders WHERE placed_at BETWEEN ? AND ? AND payment_status IN ('unpaid','pending')`,
    fromIso,
    toIso,
  );
  const units = await one(
    db,
    `SELECT COALESCE(SUM(-qty_delta),0) AS t FROM inventory_movements WHERE kind = 'sale' AND created_at BETWEEN ? AND ?`,
    fromIso,
    toIso,
  );
  const preorders = await one(
    db,
    `SELECT COALESCE(SUM(oi.qty),0) AS units, COUNT(DISTINCT o.id) AS orders
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.fulfilment_model = 'preorder' AND o.placed_at BETWEEN ? AND ? AND o.payment_status IN ${PAID_STATES}`,
    fromIso,
    toIso,
  );
  const restock = await one(
    db,
    `SELECT COALESCE(SUM(qty * COALESCE(unit_cost_cents,0)),0) AS t FROM restocks WHERE restock_date BETWEEN ? AND ?`,
    from.slice(0, 10),
    to.slice(0, 10),
  );
  const inventoryValue = await one(
    db,
    `SELECT COALESCE(SUM(i.physical_stock * COALESCE(p.cost_cents,0)),0) AS t FROM inventory i JOIN products p ON p.id = i.product_id`,
  );
  const waitlistRow = await one(db, 'SELECT COUNT(*) AS total, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS converted FROM waitlist', 'converted');
  const preorderOrders = await one(
    db,
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN o.payment_status IN ${PAID_STATES} THEN 1 ELSE 0 END) AS paid
     FROM orders o WHERE o.placed_at BETWEEN ? AND ? AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.fulfilment_model = 'preorder')`,
    fromIso,
    toIso,
  );
  const physicalRow = await one(db, 'SELECT COALESCE(SUM(physical_stock),0) AS t FROM inventory');

  const productRows = await all(
    db,
    `SELECT p.id, p.name, SUM(oi.qty) AS units, SUM(oi.line_total_cents) AS revenue,
            SUM(oi.qty * COALESCE(p.cost_cents,0)) AS cost
     FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
     WHERE o.paid_at BETWEEN ? AND ? AND o.payment_status IN ${PAID_STATES}
     GROUP BY p.id ORDER BY revenue DESC`,
    fromIso,
    toIso,
  );
  const countryRows = await all(
    db,
    `SELECT country, COUNT(*) AS orders, SUM(total_cents) AS revenue FROM orders
     WHERE paid_at BETWEEN ? AND ? AND payment_status IN ${PAID_STATES}
     GROUP BY country ORDER BY revenue DESC`,
    fromIso,
    toIso,
  );

  const paidOrderCount = Number(orders.paid || 0);
  const grossValue = Number(gross.t || 0);
  const unitsSold = Number(units.t || 0);
  const physical = Number(physicalRow.t || 0);
  const preorderTotal = Number(preorderOrders.total || 0);
  const waitlistTotal = Number(waitlistRow.total || 0);

  return {
    report: {
      gross: grossValue,
      refunds: Number(refunds.t || 0),
      net: grossValue - Number(refunds.t || 0),
      orderCount: Number(orders.total || 0),
      paidOrderCount,
      aov: paidOrderCount ? Math.round(grossValue / paidOrderCount) : 0,
      pending: Number(pending.t || 0),
      unitsSold,
      preorderUnits: Number(preorders.units || 0),
      preorderOrders: Number(preorders.orders || 0),
      restockCost: Number(restock.t || 0),
      inventoryValue: Number(inventoryValue.t || 0),
      waitlistTotal,
      waitlistConverted: Number(waitlistRow.converted || 0),
      waitlistConversion: waitlistTotal ? Math.round((Number(waitlistRow.converted || 0) / waitlistTotal) * 100) : 0,
      preorderConversion: preorderTotal ? Math.round((Number(preorderOrders.paid || 0) / preorderTotal) * 100) : 0,
      turnover: physical > 0 ? unitsSold / physical : 0,
    },
    products: productRows.map((r) => ({ name: r.name, units: Number(r.units), revenue: Number(r.revenue), cost: Number(r.cost) })),
    countries: countryRows.map((r) => ({ country: r.country, orders: Number(r.orders), revenue: Number(r.revenue) })),
  };
}
