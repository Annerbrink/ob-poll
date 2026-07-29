'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MIGRATIONS = path.join(__dirname, '..', 'migrations');

/**
 * A stand-in for a D1 binding: prepare/bind/first/all/run/batch on top of an
 * in-memory SQLite database. D1 is SQLite, so the SQL under test is the real
 * thing — what this cannot prove is how Cloudflare behaves in production, which
 * is what the smoke test after deploying is for.
 *
 * The migrations are applied in order, exactly as wrangler applies them to D1,
 * so the double's schema stays in step with production's.
 */
function fakeD1() {
  const db = new Database(':memory:');
  for (const file of fs.readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  }

  function prepare(sql) {
    const statement = db.prepare(sql);
    let bound = [];

    const api = {
      bind(...values) {
        bound = values;
        return api;
      },
      async first() {
        return statement.get(...bound) || null;
      },
      async all() {
        return { results: statement.all(...bound), success: true };
      },
      async run() {
        const info = statement.run(...bound);
        return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
      }
    };
    return api;
  }

  return {
    prepare,

    /** D1 runs a batch as one transaction, so the double does too. */
    async batch(statements) {
      const results = [];
      db.exec('BEGIN');
      try {
        for (const statement of statements) results.push(await statement.run());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return results;
    }
  };
}

module.exports = { fakeD1 };
