/** Migrations and fail-closed bootstrap. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from '../scripts/d1-shim.mjs';
import { ensureReady, runMigrations } from '../src/lib/bootstrap.js';
import { createEnv } from './helpers.mjs';
import { MIGRATIONS } from '../src/db/migrations.js';

const ALL_IDS = MIGRATIONS.map((m) => m.id);

test('baseline migration is recorded once and is idempotent', async () => {
  const env = await createEnv();
  const rows = (await env.DB.prepare('SELECT id FROM schema_migrations').all()).results;
  assert.deepEqual(rows.map((r) => r.id), ALL_IDS);
  const again = await runMigrations(env.DB);
  assert.deepEqual(again, []);
});

test('new migrations apply in order and only once', async () => {
  const env = await createEnv();
  const extra = [
    ...MIGRATIONS,
    { id: '9999_test_table', sql: 'CREATE TABLE IF NOT EXISTS mig_probe (id TEXT PRIMARY KEY); CREATE INDEX IF NOT EXISTS idx_mig_probe ON mig_probe(id)' },
  ];
  assert.deepEqual(await runMigrations(env.DB, extra), ['9999_test_table']);
  assert.deepEqual(await runMigrations(env.DB, extra), []);
  await env.DB.prepare("INSERT INTO mig_probe (id) VALUES ('x')").run();
});

test('a database created before migrations existed is adopted without data loss', async () => {
  const env = await createEnv();
  await env.DB.prepare('DROP TABLE schema_migrations').run();
  const before = (await env.DB.prepare('SELECT COUNT(*) AS n FROM products').first()).n;
  assert.ok(before > 0);
  assert.deepEqual(await runMigrations(env.DB), ALL_IDS);
  const after = (await env.DB.prepare('SELECT COUNT(*) AS n FROM products').first()).n;
  assert.equal(after, before);
});

test('founder seed fails closed without FOUNDER_PASSWORD', async () => {
  const env = { DB: createD1(':memory:') };
  await assert.rejects(() => ensureReady(env), /FOUNDER_PASSWORD is not set/);
  const users = (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n;
  assert.equal(users, 0);
  const settings = (await env.DB.prepare('SELECT COUNT(*) AS n FROM settings').first()).n;
  assert.equal(settings, 0, 'nothing is seeded when the guard trips');
});

test('founder seed rejects a short password and honours the explicit dev opt-in', async () => {
  await assert.rejects(() => ensureReady({ DB: createD1(':memory:'), FOUNDER_PASSWORD: 'short' }), /at least 12/);
  const dev = { DB: createD1(':memory:'), ALLOW_DEV_DEFAULTS: '1' };
  await ensureReady(dev);
  const users = (await dev.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n;
  assert.equal(users, 1);
});
