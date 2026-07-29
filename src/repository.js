'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const CHOICES = ['1', 'X', '2'];

/**
 * The data layer. Everything above this module talks to polls and votes only
 * through the object returned by createRepository(), so swapping SQLite for
 * Postgres or the CMS's own store means reimplementing these seven methods.
 */
function createRepository({ file = path.join(__dirname, '..', 'data', 'polls.db') } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

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
    selectTally: db.prepare('SELECT choice, COUNT(*) AS n FROM votes WHERE poll_id = ? GROUP BY choice')
  };

  function toPoll(row) {
    if (!row) return null;
    return {
      id: row.id,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      kickoff: row.kickoff,
      closesAt: row.closes_at,
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  }

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
      return poll;
    },

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
      statements.upsertVote.run({ pollId, voterId, choice, now: new Date().toISOString() });
    },

    getVote({ pollId, voterId }) {
      const row = statements.selectVote.get(pollId, voterId);
      return row ? row.choice : null;
    },

    getTally(pollId) {
      const counts = { 1: 0, X: 0, 2: 0 };
      for (const row of statements.selectTally.all(pollId)) counts[row.choice] = row.n;
      return counts;
    },

    close() {
      db.close();
    }
  };
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
