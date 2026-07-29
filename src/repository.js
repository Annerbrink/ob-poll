'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const CHOICES = ['1', 'X', '2'];
const COUNT_COLUMNS = { 1: 'count_1', X: 'count_x', 2: 'count_2' };

/**
 * The data layer. Everything above this module talks to polls and votes only
 * through the object returned by createRepository(), so swapping SQLite for
 * Postgres, D1 or the CMS's own store means reimplementing these six methods.
 */
function createRepository({ file = path.join(__dirname, '..', 'data', 'polls.db') } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  addTallyColumns(db);

  const statements = {
    insertPoll: db.prepare(`
      INSERT INTO polls (id, home_team, away_team, kickoff, closes_at, created_by, created_at)
      VALUES (@id, @homeTeam, @awayTeam, @kickoff, @closesAt, @createdBy, @createdAt)
    `),
    selectPoll: db.prepare('SELECT * FROM polls WHERE id = ?'),
    selectPolls: db.prepare('SELECT * FROM polls ORDER BY created_at DESC LIMIT ?'),
    deletePoll: db.prepare('DELETE FROM polls WHERE id = ?'),
    upsertVote: db.prepare(`
      INSERT INTO votes (poll_id, voter_id, choice, created_at, updated_at)
      VALUES (@pollId, @voterId, @choice, @now, @now)
      ON CONFLICT (poll_id, voter_id)
      DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at
    `),
    selectVote: db.prepare('SELECT choice FROM votes WHERE poll_id = ? AND voter_id = ?'),
    countVotes: db.prepare('SELECT choice, COUNT(*) AS n FROM votes WHERE poll_id = ? GROUP BY choice'),
    adjustCount: {}
  };

  for (const choice of CHOICES) {
    const column = COUNT_COLUMNS[choice];
    statements.adjustCount[choice] = db.prepare(
      `UPDATE polls SET ${column} = ${column} + ? WHERE id = ?`
    );
  }

  function toPoll(row) {
    if (!row) return null;
    return {
      id: row.id,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      kickoff: row.kickoff,
      closesAt: row.closes_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      counts: { 1: row.count_1, X: row.count_x, 2: row.count_2 }
    };
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

  return {
    createPoll({ homeTeam, awayTeam, kickoff = null, closesAt = null, createdBy = null }) {
      const poll = {
        id: buildId(homeTeam, awayTeam),
        homeTeam,
        awayTeam,
        kickoff,
        closesAt,
        createdBy,
        createdAt: new Date().toISOString()
      };
      statements.insertPoll.run(poll);
      return { ...poll, counts: { 1: 0, X: 0, 2: 0 } };
    },

    /** One row, tally included — no second query to count the votes. */
    getPoll(id) {
      return toPoll(statements.selectPoll.get(id));
    },

    listPolls({ limit = 50 } = {}) {
      return statements.selectPolls.all(limit).map(toPoll);
    },

    deletePoll(id) {
      return statements.deletePoll.run(id).changes > 0;
    },

    /** Casting again with a different sign moves the reader's vote rather than adding one. */
    castVote({ pollId, voterId, choice }) {
      castVote({ pollId, voterId, choice, now: new Date().toISOString() });
    },

    getVote({ pollId, voterId }) {
      const row = statements.selectVote.get(pollId, voterId);
      return row ? row.choice : null;
    },

    /** Counts rebuilt from the votes themselves — for tests and repair, not for serving. */
    recount(pollId) {
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

function buildId(homeTeam, awayTeam) {
  const slug = [homeTeam, awayTeam]
    .join(' vs ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  return `${slug || 'poll'}-${crypto.randomBytes(3).toString('hex')}`;
}

module.exports = { createRepository, CHOICES };
