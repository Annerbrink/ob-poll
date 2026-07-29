'use strict';

/** Turns a polls row into the shape the rest of the code works with. */
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

module.exports = { toPoll };
