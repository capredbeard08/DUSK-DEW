/**
 * Schema creation + first-run seeding, executed once per Worker isolate.
 *
 * Cloudflare D1's `exec` does not parse the full multi-statement schema, so
 * statements are split and applied in small atomic batches (with a per-statement
 * fallback). Everything is IF NOT EXISTS, so retries are safe.
 */
import { SCHEMA } from '../db/schema.js';
import { seedDatabase } from '../db/seed.js';

export function schemaStatements(sql = SCHEMA) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .filter((statement) => !/^PRAGMA\b/i.test(statement));
}

export async function applySchema(db) {
  const statements = schemaStatements();
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

export async function ensureReady(env) {
  if (env.__ddReady) return;
  let needsSchema = true;
  try {
    // The schema version row is the source of truth, so a partially created
    // database is repaired rather than treated as complete.
    const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'schema_version'`).first();
    needsSchema = !row;
  } catch {
    needsSchema = true;
  }
  if (needsSchema) {
    await applySchema(env.DB);
  }
  await seedDatabase(env.DB, env);
  env.__ddReady = true;
}
