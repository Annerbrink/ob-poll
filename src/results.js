'use strict';

const { CHOICES } = require('./repository');

/**
 * Percentages rounded with the largest-remainder method, so the three numbers
 * a reader sees always add up to exactly 100.
 */
function toPercentages(counts) {
  const total = CHOICES.reduce((sum, choice) => sum + counts[choice], 0);
  if (total === 0) return { 1: 0, X: 0, 2: 0 };

  const exact = CHOICES.map(choice => (counts[choice] / total) * 100);
  const whole = exact.map(Math.floor);
  const remaining = 100 - whole.reduce((a, b) => a + b, 0);

  exact
    .map((value, index) => ({ index, fraction: value - whole[index] }))
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, remaining)
    .forEach(entry => { whole[entry.index] += 1; });

  return { 1: whole[0], X: whole[1], 2: whole[2] };
}

function isClosed(poll, now = new Date()) {
  return Boolean(poll.closesAt) && new Date(poll.closesAt) <= now;
}

/** The public shape of a poll, as served to the widget. */
function present(poll, counts, yourVote) {
  const total = CHOICES.reduce((sum, choice) => sum + counts[choice], 0);
  return {
    id: poll.id,
    homeTeam: poll.homeTeam,
    awayTeam: poll.awayTeam,
    kickoff: poll.kickoff,
    closesAt: poll.closesAt,
    closed: isClosed(poll),
    counts,
    percentages: toPercentages(counts),
    total,
    yourVote: yourVote || null
  };
}

module.exports = { toPercentages, isClosed, present };
