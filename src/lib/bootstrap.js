/**
 * Versioned migrations + first-run seeding, executed once per Worker isolate.
 *
 * Migrations live in src/db/migrations.js and are recorded in
 * `schema_migrations`, so changing the schema after real orders exist is an
 * append-only operation. Cloudflare D1's `exec` does not parse multi-statement
 * SQL reliably, so each migration is split into statements and applied in small
 * atomic batches (with a per-statement fallback). Databases created before the
 * migration table existed are adopted: the baseline is idempotent.
 */
import { MIGRATIONS } from '../db/migrations.js';
import { seedDatabase } from '../db/seed.js';

export function schemaStatements(sql) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .filter((statement) => !/^PRAGMA\b/i.test(statement));
}

async function applyStatements(db, statements) {
  const chunkSize = 20;
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize);
    try {
      await db.batch(chunk.map((sql) => db.prepare(sql)));
    } catch {
      for (const sql of chunk) {
        await db.exec(sql);
      }
    }
  }
}

export async function runMigrations(db, migrations = MIGRATIONS) {
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`)
    .run();
  const rows = await db.prepare('SELECT id FROM schema_migrations').all();
  const done = new Set(((rows && rows.results) || []).map((r) => r.id));
  const applied = [];
  for (const migration of migrations) {
    if (done.has(migration.id)) continue;
    await applyStatements(db, schemaStatements(migration.sql));
    await db
      .prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)')
      .bind(migration.id, new Date().toISOString())
      .run();
    applied.push(migration.id);
  }
  return applied;
}

export async function ensureReady(env) {
  if (env.__ddReady) return;
  await runMigrations(env.DB);
  await seedDatabase(env.DB, env);
  env.__ddReady = true;
}
