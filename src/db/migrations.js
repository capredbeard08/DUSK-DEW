/**
 * Ordered, append-only database migrations.
 *
 * Rules:
 *  - Never edit or reorder a migration that has shipped. Add a new one at the end.
 *  - `id` must be unique and sort in application order (NNNN_description).
 *  - Statements are split on ';' (see bootstrap.js), so do not put ';' inside
 *    string literals or trigger bodies.
 *  - Write each migration so a retry after a partial failure is safe
 *    (CREATE ... IF NOT EXISTS, or guard with a preceding check).
 *
 * Example of a future migration:
 *   { id: '0002_product_prices', sql: `CREATE TABLE IF NOT EXISTS product_prices (...); CREATE INDEX ...;` }
 */
import { SCHEMA } from './schema.js';

export const MIGRATIONS = [
  // Baseline: the schema Freebuff shipped. Fully idempotent, so databases that
  // were created before the migration table existed are adopted safely.
  { id: '0001_baseline', sql: SCHEMA },

  // Phase 2: per-currency prices, shipping zones with duties handling, and
  // itemised order charges. Purely additive: existing products, countries and
  // orders keep working unchanged (see src/lib/pricing.js for the fallbacks).
  {
    id: '0002_multicurrency_shipping',
    sql: `
CREATE TABLE IF NOT EXISTS product_prices (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, currency)
);
INSERT OR IGNORE INTO product_prices (product_id, currency, price_cents, updated_at)
  SELECT id, currency, price_cents, updated_at FROM products;
CREATE TABLE IF NOT EXISTS shipping_zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  free_over_cents INTEGER CHECK (free_over_cents IS NULL OR free_over_cents > 0),
  delivery_estimate TEXT,
  duties_mode TEXT NOT NULL DEFAULT 'ddu' CHECK (duties_mode IN ('ddu','ddp')),
  duty_bps INTEGER NOT NULL DEFAULT 0 CHECK (duty_bps >= 0 AND duty_bps <= 10000),
  customs_note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS country_zone (
  country_code TEXT PRIMARY KEY REFERENCES supported_countries(code) ON DELETE CASCADE,
  zone_id TEXT NOT NULL REFERENCES shipping_zones(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_country_zone_zone ON country_zone(zone_id);
CREATE TABLE IF NOT EXISTS order_charges (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('duties')),
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0)
);
CREATE INDEX IF NOT EXISTS idx_order_charges_order ON order_charges(order_id);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured, created_at)
`,
  },
];
