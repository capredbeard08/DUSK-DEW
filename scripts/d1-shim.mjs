/**
 * A D1-compatible adapter over Node's built-in SQLite, used only for local
 * development and automated tests. The Worker itself only uses the D1 API.
 */
import { DatabaseSync } from 'node:sqlite';

function normalise(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function createStatement(db, sql, args = []) {
  const run = () => db.prepare(sql).run(...args.map(normalise));
  return {
    __sql: sql,
    __args: args,
    bind(...next) {
      return createStatement(db, sql, next);
    },
    async first(column) {
      const row = db.prepare(sql).get(...args.map(normalise));
      if (!row) return null;
      if (column) return row[column];
      return { ...row };
    },
    async all() {
      const rows = db.prepare(sql).all(...args.map(normalise));
      return { results: rows.map((r) => ({ ...r })), success: true, meta: {} };
    },
    async run() {
      const info = run();
      return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
    async raw() {
      const rows = db.prepare(sql).all(...args.map(normalise));
      return rows.map((r) => Object.values(r));
    },
  };
}

export function createD1(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  return {
    __sqlite: db,
    prepare(sql) {
      return createStatement(db, sql);
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          const info = db.prepare(statement.__sql).run(...statement.__args.map(normalise));
          results.push({ success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) }, results: [] });
        }
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(sql) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
    close() {
      db.close();
    },
  };
}

/** Convenience for tests: run a statement and return rows. */
export async function rows(db, sql, ...args) {
  return (await db.prepare(sql).bind(...args).all()).results;
}
