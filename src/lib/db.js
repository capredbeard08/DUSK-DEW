/** Thin helpers over the D1 prepared-statement API (also used by tests). */

export const nowIso = () => new Date().toISOString();

export function uid(prefix = '') {
  const raw = globalThis.crypto.randomUUID().replace(/-/g, '');
  return `${prefix}${raw.slice(0, 24)}`;
}

export function orderReference(seq) {
  return `DD-${String(seq).padStart(4, '0')}`;
}

export async function one(db, sql, ...args) {
  return db.prepare(sql).bind(...args).first();
}

export async function all(db, sql, ...args) {
  const res = await db.prepare(sql).bind(...args).all();
  return (res && res.results) || [];
}

export async function run(db, sql, ...args) {
  return db.prepare(sql).bind(...args).run();
}

export async function scalar(db, sql, ...args) {
  const row = await one(db, sql, ...args);
  if (!row) return null;
  return row[Object.keys(row)[0]];
}

export function stmt(db, sql, ...args) {
  return db.prepare(sql).bind(...args);
}

export async function tx(db, statements) {
  if (!statements.length) return [];
  return db.batch(statements);
}

export async function setting(db, key, fallback = '') {
  const row = await one(db, 'SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}

export async function settingsMap(db) {
  const rows = await all(db, 'SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(db, key, value) {
  await run(
    db,
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    String(value),
    nowIso(),
  );
}

export async function audit(db, { userId = null, actorEmail = null, action, entityType = null, entityId = null, details = null, ip = null }) {
  await run(
    db,
    `INSERT INTO audit_logs (id, user_id, actor_email, action, entity_type, entity_id, details, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    uid('aud_'),
    userId,
    actorEmail,
    action,
    entityType,
    entityId,
    details ? JSON.stringify(details) : null,
    ip,
    nowIso(),
  );
}

export function paginate(query, page, perPage = 20) {
  const total = Number(query.total || 0);
  const current = Math.max(1, Number(page) || 1);
  const pages = Math.max(1, Math.ceil(total / perPage));
  return {
    total,
    page: Math.min(current, pages),
    pages,
    perPage,
    offset: (Math.min(current, pages) - 1) * perPage,
  };
}
