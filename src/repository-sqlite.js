'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { CHOICES, COUNT_COLUMNS } = require('./choices');
const { buildId } = require('./poll-id');
const { toPoll } = require('./rows');

const SCHEMA = path.join(__dirname, '..', 'migrations', '0001_init.sql');

/**
 * The data layer on a local SQLite file — used for development and for anyone
 * running the poll on their own server. Its Cloudflare counterpart lives in
 * repository-d1.js and speaks the same six methods; the SQL is shared, since D1
 * is SQLite too.
 *
 * Every method is async even though better-sqlite3 is synchronous, so that both
 * implementations are interchangeable.
 */
function createSqliteRepository({ file = path.join(__dirname, '..', 'data', 'polls.db') } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(SCHEMA, 'utf8'));
  addTallyColumns(db);
  addCategoryColumn(db);

  const statements = {
    insertPoll: db.prepare(`
      INSERT INTO polls (id, home_team, away_team, kickoff, closes_at, category, created_by, created_at)
      VALUES (@id, @homeTeam, @awayTeam, @kickoff, @closesAt, @category, @createdBy, @createdAt)
    `),
    selectPoll: db.prepare('SELECT * FROM polls WHERE id = ?'),
    selectPolls: db.prepare('SELECT * FROM polls ORDER BY created_at DESC LIMIT ?'),
    updatePoll: db.prepare(`
      UPDATE polls
      SET home_team = @homeTeam, away_team = @awayTeam,
          kickoff = @kickoff, closes_at = @closesAt, category = @category
      WHERE id = @id
    `),
    deletePoll: db.prepare('DELETE FROM polls WHERE id = ?'),
    upsertVote: db.prepare(`
      INSERT INTO votes (poll_id, voter_id, choice, created_at, updated_at)
      VALUES (@pollId, @voterId, @choice, @now, @now)
      ON CONFLICT (poll_id, voter_id)
      DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at
    `),
    selectVote: db.prepare('SELECT choice FROM votes WHERE poll_id = ? AND voter_id = ?'),
    deleteVote: db.prepare('DELETE FROM votes WHERE poll_id = ? AND voter_id = ?'),
    countVotes: db.prepare('SELECT choice, COUNT(*) AS n FROM votes WHERE poll_id = ? GROUP BY choice'),
    adjustCount: {}
  };

  for (const choice of CHOICES) {
    const column = COUNT_COLUMNS[choice];
    statements.adjustCount[choice] = db.prepare(
      `UPDATE polls SET ${column} = ${column} + ? WHERE id = ?`
    );
  }

  /**
   * Moving a vote has to touch the votes row and the tally together, or the
   * two disagree the moment something fails in between.
   */
  const castVote = db.transaction(({ pollId, voterId, choice, now }) => {
    const previous = statements.selectVote.get(pollId, voterId);
    if (previous && previous.choice === choice) return;

    statements.upsertVote.run({ pollId, voterId, choice, now });
    if (previous) statements.adjustCount[previous.choice].run(-1, pollId);
    statements.adjustCount[choice].run(1, pollId);
  });

  const removeVote = db.transaction(({ pollId, voterId }) => {
    const previous = statements.selectVote.get(pollId, voterId);
    if (!previous) return false;

    statements.deleteVote.run(pollId, voterId);
    statements.adjustCount[previous.choice].run(-1, pollId);
    return true;
  });

  return {
    async createPoll({ homeTeam, awayTeam, kickoff = null, closesAt = null, category = null, createdBy = null }) {
      const poll = {
        id: buildId(homeTeam, awayTeam),
        homeTeam,
        awayTeam,
        kickoff,
        closesAt,
        category,
        createdBy,
        createdAt: new Date().toISOString()
      };
      statements.insertPoll.run(poll);
      return { ...poll, counts: { 1: 0, X: 0, 2: 0 } };
    },

    /** One row, tally included — no second query to count the votes. */
    async getPoll(id) {
      return toPoll(statements.selectPoll.get(id));
    },

    /** Edits the fixture without touching the id or the votes already cast. */
    async updatePoll(id, { homeTeam, awayTeam, kickoff = null, closesAt = null, category = null }) {
      const result = statements.updatePoll.run({ id, homeTeam, awayTeam, kickoff, closesAt, category });
      return result.changes > 0 ? toPoll(statements.selectPoll.get(id)) : null;
    },

    async listPolls({ limit = 50 } = {}) {
      return statements.selectPolls.all(limit).map(toPoll);
    },

    async deletePoll(id) {
      return statements.deletePoll.run(id).changes > 0;
    },

    /** Casting again with a different sign moves the reader's vote rather than adding one. */
    async castVote({ pollId, voterId, choice }) {
      castVote({ pollId, voterId, choice, now: new Date().toISOString() });
    },

    /** Removes the reader's vote and decrements the tally; false if they had none. */
    async removeVote({ pollId, voterId }) {
      return removeVote({ pollId, voterId });
    },

    async getVote({ pollId, voterId }) {
      const row = statements.selectVote.get(pollId, voterId);
      return row ? row.choice : null;
    },

    /** Counts rebuilt from the votes themselves — for tests and repair, not for serving. */
    async recount(pollId) {
      const counts = { 1: 0, X: 0, 2: 0 };
      for (const row of statements.countVotes.all(pollId)) counts[row.choice] = row.n;
      return counts;
    },

    close() {
      db.close();
    }
  };
}

/** Brings a database created before the tally columns existed up to date. */
function addTallyColumns(db) {
  const columns = db.prepare('PRAGMA table_info(polls)').all().map(column => column.name);
  const missing = Object.values(COUNT_COLUMNS).filter(column => !columns.includes(column));
  if (missing.length === 0) return;

  db.transaction(() => {
    for (const column of missing) {
      db.prepare(`ALTER TABLE polls ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`).run();
    }
    for (const choice of CHOICES) {
      db.prepare(`
        UPDATE polls SET ${COUNT_COLUMNS[choice]} = (
          SELECT COUNT(*) FROM votes WHERE votes.poll_id = polls.id AND votes.choice = ?
        )
      `).run(choice);
    }
  })();
}

/** Brings a database created before the category column existed up to date. */
function addCategoryColumn(db) {
  const columns = db.prepare('PRAGMA table_info(polls)').all().map(column => column.name);
  if (columns.includes('category')) return;
  db.prepare('ALTER TABLE polls ADD COLUMN category TEXT').run();
}

module.exports = { createSqliteRepository };
