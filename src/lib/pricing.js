/**
 * Multi-currency pricing, shipping zones and duties.
 *
 * Money rules:
 *  - Integers in minor units only. A product is sold in a currency only if it
 *    has an explicit price for it (product_prices). There is NO automatic FX
 *    conversion: prices in each currency are a business decision.
 *  - Duties: 'ddu' = customer pays customs on delivery (nothing is charged
 *    here; the zone's customs note is shown). 'ddp' = we collect an estimated
 *    duty (duty_bps of the subtotal) at checkout and store it in order_charges.
 *  - Backwards compatible: a country with no zone behaves exactly as before
 *    (store default currency, supported_countries.shipping_cents, no duties).
 */
import { all, one } from './db.js';

export const CURRENCIES = ['USD', 'GBP', 'EUR', 'NGN'];

export function isCurrency(code) {
  return CURRENCIES.includes(String(code || '').toUpperCase());
}

/** Explicit price for a product in a currency, or null if it is not sold in it. */
export function priceIn(product, prices, currency) {
  const hit = prices && prices[currency];
  if (Number.isInteger(hit)) return hit;
  // Legacy fallback: the product's own base price/currency.
  if (product.currency === currency && Number.isInteger(product.price_cents)) return product.price_cents;
  return null;
}

export async function pricesForProducts(db, productIds) {
  if (!productIds.length) return new Map();
  const marks = productIds.map(() => '?').join(',');
  const rows = await all(db, `SELECT product_id, currency, price_cents FROM product_prices WHERE product_id IN (${marks})`, ...productIds);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.product_id)) map.set(row.product_id, {});
    map.get(row.product_id)[row.currency] = row.price_cents;
  }
  return map;
}

export async function zoneForCountry(db, countryCode) {
  return one(
    db,
    `SELECT z.* FROM country_zone cz JOIN shipping_zones z ON z.id = cz.zone_id WHERE cz.country_code = ?`,
    countryCode,
  );
}

/**
 * Quote an order. `lines` = [{ product, qty }]. Returns
 *   { ok: true, currency, subtotal, shipping, duties, total, zone, lines: [{...line, unitCents, lineTotal}] }
 * or { ok: false, error }.
 */
export async function quoteOrder(db, { country, lines, defaultCurrency = 'USD' }) {
  if (!country) return { ok: false, error: 'We do not ship to that destination yet.' };
  const zone = await zoneForCountry(db, country.code);
  let currency;
  let shippingBase;
  if (zone) {
    currency = zone.currency;
    shippingBase = Number(zone.shipping_cents);
  } else {
    if (country.shipping_cents === null || country.shipping_cents === undefined) {
      return { ok: false, error: 'Shipping to that destination is not priced yet.' };
    }
    currency = defaultCurrency;
    shippingBase = Number(country.shipping_cents);
  }

  const priceMap = await pricesForProducts(db, lines.map((l) => l.product.id));
  const priced = [];
  for (const line of lines) {
    const unit = priceIn(line.product, priceMap.get(line.product.id), currency);
    if (unit === null) {
      return { ok: false, error: `${line.product.name} is not available in ${currency} for that destination.` };
    }
    priced.push({ ...line, unitCents: unit, lineTotal: unit * line.qty });
  }

  const subtotal = priced.reduce((sum, l) => sum + l.lineTotal, 0);
  let shipping = shippingBase;
  if (zone && zone.free_over_cents && subtotal >= Number(zone.free_over_cents)) shipping = 0;
  let duties = 0;
  if (zone && zone.duties_mode === 'ddp' && zone.duty_bps > 0) {
    duties = Math.round((subtotal * Number(zone.duty_bps)) / 10000);
  }
  return { ok: true, currency, subtotal, shipping, duties, total: subtotal + shipping + duties, zone: zone || null, lines: priced };
}

/** "12.50" -> 1250; blank/invalid -> null. */
export function toCents(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

/**
 * Persist explicit prices from a product form. The base currency's price comes
 * from the main price field; every other currency from `price_<CODE>` (blank =
 * not sold in that currency).
 */
export async function savePrices(db, productId, form, baseCurrency, baseCents, now) {
  const statements = [];
  for (const code of CURRENCIES) {
    const cents = code === baseCurrency ? baseCents : toCents(form.get(`price_${code}`));
    if (cents === null || cents === undefined) {
      statements.push(db.prepare('DELETE FROM product_prices WHERE product_id = ? AND currency = ?').bind(productId, code));
    } else {
      statements.push(
        db
          .prepare(
            `INSERT INTO product_prices (product_id, currency, price_cents, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(product_id, currency) DO UPDATE SET price_cents = excluded.price_cents, updated_at = excluded.updated_at`,
          )
          .bind(productId, code, cents, now),
      );
    }
  }
  await db.batch(statements);
}

/** Hard-delete a product that has never been ordered. Otherwise refuse (archive instead). */
export async function deleteProductIfUnused(db, productId) {
  const used = await one(db, 'SELECT COUNT(*) AS n FROM order_items WHERE product_id = ?', productId);
  if (used && used.n > 0) return { ok: false, error: 'This product appears on orders, so it cannot be deleted. Archive it instead.' };
  const live = await one(db, 'SELECT COUNT(*) AS n FROM inventory_reservations WHERE product_id = ?', productId);
  if (live && live.n > 0) return { ok: false, error: 'This product has stock reservations. Archive it instead.' };
  await db.batch(
    ['inventory_movements', 'restocks', 'stock_adjustments', 'batch_items'].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE product_id = ?`).bind(productId),
    ).concat([db.prepare('DELETE FROM products WHERE id = ?').bind(productId)]),
  );
  return { ok: true };
}

/** Remove the demonstration records created by the seed. Real orders are never touched. */
export async function purgeSampleData(db) {
  const orders = await all(db, `SELECT id FROM orders WHERE payment_provider = 'sample'`);
  const statements = [];
  for (const { id } of orders) {
    statements.push(db.prepare('DELETE FROM inventory_movements WHERE reference_type = ? AND reference_id = ?').bind('order', id));
    statements.push(db.prepare('DELETE FROM refunds WHERE order_id = ?').bind(id));
    statements.push(db.prepare('DELETE FROM inventory_reservations WHERE order_id = ?').bind(id));
    statements.push(db.prepare('DELETE FROM orders WHERE id = ?').bind(id));
  }
  statements.push(db.prepare(`DELETE FROM customers WHERE email = 'sample.customer@example.com' AND id NOT IN (SELECT customer_id FROM orders WHERE customer_id IS NOT NULL)`));
  statements.push(db.prepare(`DELETE FROM waitlist WHERE email = 'sample.waitlist@example.com'`));
  statements.push(
    db.prepare(`DELETE FROM production_batches WHERE reference = 'BATCH-2026-01' AND id NOT IN (SELECT batch_id FROM batch_items WHERE received_qty > 0)`),
  );
  statements.push(db.prepare(`UPDATE inventory SET units_sold = 0 WHERE product_id = 'prd_serum' AND units_sold = 1`));
  await db.batch(statements);
  return { orders: orders.length };
}
