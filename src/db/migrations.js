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
];
