'use strict';

const { CHOICES, COUNT_COLUMNS } = require('./choices');
const { buildId } = require('./poll-id');
const { toPoll } = require('./rows');

/**
 * The data layer on Cloudflare D1. D1 is SQLite, so the schema and the SQL are
 * the same as the local implementation's — what differs is that every call is
 * async and that several statements are sent as one batch instead of wrapped in
 * a transaction.
 */
function createD1Repository({ database }) {
  const adjustCount = {};
  for (const choice of CHOICES) {
    const column = COUNT_COLUMNS[choice];
    adjustCount[choice] = `UPDATE polls SET ${column} = ${column} + ? WHERE id = ?`;
  }

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

      await database
        .prepare(`
          INSERT INTO polls (id, home_team, away_team, kickoff, closes_at, category, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(poll.id, poll.homeTeam, poll.awayTeam, poll.kickoff, poll.closesAt, poll.category, poll.createdBy, poll.createdAt)
        .run();

      return { ...poll, counts: { 1: 0, X: 0, 2: 0 } };
    },

    /** One row, tally included — this is the query the readers hit. */
    async getPoll(id) {
      return toPoll(await database.prepare('SELECT * FROM polls WHERE id = ?').bind(id).first());
    },

    /** Edits the fixture without touching the id or the votes already cast. */
    async updatePoll(id, { homeTeam, awayTeam, kickoff = null, closesAt = null, category = null }) {
      const result = await database
        .prepare(`
          UPDATE polls
          SET home_team = ?, away_team = ?, kickoff = ?, closes_at = ?, category = ?
          WHERE id = ?
        `)
        .bind(homeTeam, awayTeam, kickoff, closesAt, category, id)
        .run();
      return result.meta.changes > 0 ? this.getPoll(id) : null;
    },

    async listPolls({ limit = 50 } = {}) {
      const { results } = await database
        .prepare('SELECT * FROM polls ORDER BY created_at DESC LIMIT ?')
        .bind(limit)
        .all();
      return (results || []).map(toPoll);
    },

    async deletePoll(id) {
      // D1 does not enforce foreign keys, so the votes are removed explicitly.
      const [, poll] = await database.batch([
        database.prepare('DELETE FROM votes WHERE poll_id = ?').bind(id),
        database.prepare('DELETE FROM polls WHERE id = ?').bind(id)
      ]);
      return poll.meta.changes > 0;
    },

    /** Casting again with a different sign moves the reader's vote rather than adding one. */
    async castVote({ pollId, voterId, choice }) {
      const previous = await this.getVote({ pollId, voterId });
      if (previous === choice) return;

      const now = new Date().toISOString();
      const writes = [
        database
          .prepare(`
            INSERT INTO votes (poll_id, voter_id, choice, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (poll_id, voter_id)
            DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at
          `)
          .bind(pollId, voterId, choice, now, now),
        database.prepare(adjustCount[choice]).bind(1, pollId)
      ];

      if (previous) writes.push(database.prepare(adjustCount[previous]).bind(-1, pollId));

      // A batch runs as a single transaction, so the vote and the tally never
      // drift apart even if one statement fails.
      await database.batch(writes);
    },

    async getVote({ pollId, voterId }) {
      const row = await database
        .prepare('SELECT choice FROM votes WHERE poll_id = ? AND voter_id = ?')
        .bind(pollId, voterId)
        .first();
      return row ? row.choice : null;
    },

    /** Removes the reader's vote and decrements the tally; false if they had none. */
    async removeVote({ pollId, voterId }) {
      const previous = await this.getVote({ pollId, voterId });
      if (!previous) return false;

      await database.batch([
        database.prepare('DELETE FROM votes WHERE poll_id = ? AND voter_id = ?').bind(pollId, voterId),
        database.prepare(adjustCount[previous]).bind(-1, pollId)
      ]);
      return true;
    },

    /** Counts rebuilt from the votes themselves — for repair, not for serving. */
    async recount(pollId) {
      const { results } = await database
        .prepare('SELECT choice, COUNT(*) AS n FROM votes WHERE poll_id = ? GROUP BY choice')
        .bind(pollId)
        .all();

      const counts = { 1: 0, X: 0, 2: 0 };
      for (const row of results || []) counts[row.choice] = row.n;
      return counts;
    }
  };
}

module.exports = { createD1Repository };
