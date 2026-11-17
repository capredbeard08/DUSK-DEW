/** Multi-currency quotes, shipping zones and duties. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from './helpers.mjs';
import { quoteOrder, isCurrency } from '../src/lib/pricing.js';

async function setup() {
  const env = await createEnv();
  const db = env.DB;
  const product = await db.prepare('SELECT * FROM products ORDER BY id LIMIT 1').first();
  const country = await db.prepare('SELECT * FROM supported_countries ORDER BY code LIMIT 1').first();
  const now = new Date().toISOString();
  return { db, product, country, now };
}

async function addZone(db, now, { id, currency, ship, freeOver = null, mode = 'ddu', bps = 0, country }) {
  await db.prepare('INSERT INTO shipping_zones (id, name, currency, shipping_cents, free_over_cents, duties_mode, duty_bps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, `Zone ${id}`, currency, ship, freeOver, mode, bps, now).run();
  await db.prepare('INSERT OR REPLACE INTO country_zone (country_code, zone_id) VALUES (?, ?)').bind(country.code, id).run();
}

test('country with no zone keeps legacy behaviour', async () => {
  const { db, product, country } = await setup();
  const c = { ...country, shipping_cents: 1500 };
  const q = await quoteOrder(db, { country: c, lines: [{ product, qty: 2 }], defaultCurrency: product.currency });
  assert.equal(q.ok, true);
  assert.equal(q.subtotal, product.price_cents * 2);
  assert.equal(q.shipping, 1500);
  assert.equal(q.duties, 0);
});

test('zone currency needs an explicit price and never converts', async () => {
  const { db, product, country, now } = await setup();
  const other = product.currency === 'GBP' ? 'EUR' : 'GBP';
  await addZone(db, now, { id: 'z1', currency: other, ship: 900, country });
  const missing = await quoteOrder(db, { country, lines: [{ product, qty: 1 }] });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not available in/);
  await db.prepare('INSERT INTO product_prices (product_id, currency, price_cents, updated_at) VALUES (?, ?, ?, ?)').bind(product.id, other, 4321, now).run();
  const ok = await quoteOrder(db, { country, lines: [{ product, qty: 3 }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.currency, other);
  assert.equal(ok.subtotal, 4321 * 3);
  assert.equal(ok.shipping, 900);
});

test('free shipping threshold and DDP duties', async () => {
  const { db, product, country, now } = await setup();
  await addZone(db, now, { id: 'z2', currency: product.currency, ship: 1200, freeOver: product.price_cents * 2, mode: 'ddp', bps: 1250, country });
  const one = await quoteOrder(db, { country, lines: [{ product, qty: 1 }] });
  assert.equal(one.shipping, 1200);
  assert.equal(one.duties, Math.round((product.price_cents * 1250) / 10000));
  const two = await quoteOrder(db, { country, lines: [{ product, qty: 2 }] });
  assert.equal(two.shipping, 0);
  assert.equal(two.total, two.subtotal + two.duties);
});

test('DDU charges no duties at checkout', async () => {
  const { db, product, country, now } = await setup();
  await addZone(db, now, { id: 'z3', currency: product.currency, ship: 500, mode: 'ddu', bps: 2000, country });
  const q = await quoteOrder(db, { country, lines: [{ product, qty: 1 }] });
  assert.equal(q.duties, 0);
});

test('unknown destination and currency validation', async () => {
  const { db, product } = await setup();
  assert.equal((await quoteOrder(db, { country: null, lines: [{ product, qty: 1 }] })).ok, false);
  assert.equal(isCurrency('usd'), true);
  assert.equal(isCurrency('XXX'), false);
});
