'use strict';

/**
 * A readable id built from the fixture, with a short random suffix so two
 * meetings between the same clubs never collide.
 */
function buildId(homeTeam, awayTeam) {
  const slug = [homeTeam, awayTeam]
    .join(' vs ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(3)), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');

  return `${slug || 'poll'}-${suffix}`;
}

module.exports = { buildId };
