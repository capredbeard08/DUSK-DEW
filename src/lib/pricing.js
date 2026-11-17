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
