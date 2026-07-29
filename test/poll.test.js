'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createSqliteRepository } = require('../src/repository-sqlite');
const { createHandler } = require('../src/handler');
const { toPercentages } = require('../src/results');

const TOKEN = 'test-token';
const BASE = 'https://poll.test';

function withApi(run) {
  const repository = createSqliteRepository({ file: ':memory:' });
  const handle = createHandler({ repository, adminToken: TOKEN });

  const call = async (path, options = {}) => {
    const response = await handle(new Request(BASE + path, {
      method: options.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, options.headers),
      body: options.body
    }));
    const body = response.status === 204 ? null : await response.json();
    return { status: response.status, body, headers: response.headers };
  };

  const author = (path, options = {}) =>
    call(path, { ...options, headers: { Authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) } });

  return run({ call, author, repository }).finally(() => repository.close());
}

test('percentages always add up to 100', () => {
  assert.deepStrictEqual(toPercentages({ 1: 1, X: 1, 2: 1 }), { 1: 34, X: 33, 2: 33 });
  assert.deepStrictEqual(toPercentages({ 1: 0, X: 0, 2: 0 }), { 1: 0, X: 0, 2: 0 });

  for (const counts of [{ 1: 47, X: 12, 2: 28 }, { 1: 1, X: 2, 2: 0 }, { 1: 5, X: 5, 2: 5 }]) {
    const pct = toPercentages(counts);
    assert.strictEqual(pct['1'] + pct.X + pct['2'], 100, JSON.stringify(counts));
  }
});

test('an author creates a poll and readers vote on it', () => withApi(async ({ call, author }) => {
  const created = await author('/api/polls', {
    method: 'POST',
    body: JSON.stringify({ homeTeam: 'Örgryte IS', awayTeam: 'IFK Göteborg' })
  });
  assert.strictEqual(created.status, 201);
  const id = created.body.poll.id;
  assert.match(id, /^orgryte-is-vs-ifk-goteborg-[a-f0-9]{6}$/);

  const first = await call(`/api/polls/${id}/votes`, {
    method: 'POST',
    body: JSON.stringify({ choice: '1' }),
    headers: { 'X-Voter-Id': 'a'.repeat(32) }
  });
  assert.strictEqual(first.body.poll.percentages['1'], 100);

  const second = await call(`/api/polls/${id}/votes`, {
    method: 'POST',
    body: JSON.stringify({ choice: 'X' }),
    headers: { 'X-Voter-Id': 'b'.repeat(32) }
  });
  assert.strictEqual(second.body.poll.total, 2);
  assert.deepStrictEqual(second.body.poll.counts, { 1: 1, X: 1, 2: 0 });
}));

test('a poll carries its match type through to the reader', () => withApi(async ({ call, author }) => {
  const created = await author('/api/polls', {
    method: 'POST',
    body: JSON.stringify({ homeTeam: 'BK Häcken', awayTeam: 'Kopparbergs/Göteborg', category: 'dam' })
  });
  assert.strictEqual(created.body.poll.category, 'dam');

  const shown = await call(`/api/polls/${created.body.poll.id}`);
  assert.strictEqual(shown.body.poll.category, 'dam');

  // Anything other than the two allowed values is dropped rather than stored.
  const untyped = await author('/api/polls', {
    method: 'POST',
    body: JSON.stringify({ homeTeam: 'AIK', awayTeam: 'Hammarby', category: 'blandat' })
  });
  assert.strictEqual(untyped.body.poll.category, null);
}));

test('an author edits a poll without disturbing its id or votes', () => withApi(async ({ call, author }) => {
  const created = await author('/api/polls', {
    method: 'POST',
    body: JSON.stringify({ homeTeam: 'Örgryte IS', awayTeam: 'GAIS', category: 'herr' })
  });
  const id = created.body.poll.id;

  await call(`/api/polls/${id}/votes`, {
    method: 'POST',
    body: JSON.stringify({ choice: '1' }),
    headers: { 'X-Voter-Id': 'a'.repeat(32) }
  });

  const anonymous = await call(`/api/polls/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ homeTeam: 'X', awayTeam: 'Y' })
  });
  assert.strictEqual(anonymous.status, 401);

  const updated = await author(`/api/polls/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ homeTeam: 'IFK Göteborg', awayTeam: 'BK Häcken', category: 'dam' })
  });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.poll.id, id);
  assert.strictEqual(updated.body.poll.homeTeam, 'IFK Göteborg');
  assert.strictEqual(updated.body.poll.category, 'dam');
  assert.strictEqual(updated.body.poll.counts['1'], 1);

  const missing = await author('/api/polls/finns-inte', {
    method: 'PUT',
    body: JSON.stringify({ homeTeam: 'A', awayTeam: 'B' })
  });
  assert.strictEqual(missing.status, 404);

  const invalid = await author(`/api/polls/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ homeTeam: '  ', awayTeam: 'B' })
  });
  assert.strictEqual(invalid.status, 400);
}));

test('a reader changing their mind moves the vote instead of adding one', () =>
  withApi(async ({ call, author }) => {
    const { body } = await author('/api/polls', {
      method: 'POST',
      body: JSON.stringify({ homeTeam: 'AIK', awayTeam: 'Djurgården' })
    });
    const id = body.poll.id;
    const voter = { 'X-Voter-Id': 'c'.repeat(32) };

    await call(`/api/polls/${id}/votes`, { method: 'POST', body: JSON.stringify({ choice: '1' }), headers: voter });
    const moved = await call(`/api/polls/${id}/votes`, { method: 'POST', body: JSON.stringify({ choice: '2' }), headers: voter });

    assert.strictEqual(moved.body.poll.total, 1);
    assert.deepStrictEqual(moved.body.poll.counts, { 1: 0, X: 0, 2: 1 });
    assert.strictEqual(moved.body.poll.yourVote, '2');
  }));

test('results survive a restart because they live in the data layer', async () => {
  const file = `${__dirname}/../data/test-${Date.now()}.db`;

  const first = createSqliteRepository({ file });
  const poll = await first.createPoll({ homeTeam: 'Hammarby', awayTeam: 'Malmö FF' });
  await first.castVote({ pollId: poll.id, voterId: 'x'.repeat(32), choice: 'X' });
  first.close();

  const second = createSqliteRepository({ file });
  assert.deepStrictEqual((await second.getPoll(poll.id)).counts, { 1: 0, X: 1, 2: 0 });
  assert.strictEqual((await second.getPoll(poll.id)).homeTeam, 'Hammarby');
  second.close();

  for (const suffix of ['', '-wal', '-shm']) {
    require('node:fs').rmSync(file + suffix, { force: true });
  }
});

test('voting is rejected once the poll has closed', () => withApi(async ({ call, author }) => {
  const { body } = await author('/api/polls', {
    method: 'POST',
    body: JSON.stringify({
      homeTeam: 'GAIS',
      awayTeam: 'BK Häcken',
      kickoff: new Date(Date.now() - 3600e3).toISOString()
    })
  });

  const attempt = await call(`/api/polls/${body.poll.id}/votes`, {
    method: 'POST',
    body: JSON.stringify({ choice: '1' })
  });
  assert.strictEqual(attempt.status, 409);
  assert.match(attempt.body.error, /stängd/);
}));

test('poll creation requires the author token and valid input', () => withApi(async ({ call, author }) => {
  const anonymous = await call('/api/polls', {
    method: 'POST',
    body: JSON.stringify({ homeTeam: 'A', awayTeam: 'B' })
  });
  assert.strictEqual(anonymous.status, 401);

  const missingTeam = await author('/api/polls', {
    method: 'POST',
    body: JSON.stringify({ homeTeam: '  ', awayTeam: 'B' })
  });
  assert.strictEqual(missingTeam.status, 400);

  const badDate = await author('/api/polls', {
    method: 'POST',
    body: JSON.stringify({ homeTeam: 'A', awayTeam: 'B', kickoff: 'i morgon' })
  });
  assert.strictEqual(badDate.status, 400);

  const closesBeforeKickoff = await author('/api/polls', {
    method: 'POST',
    body: JSON.stringify({
      homeTeam: 'A',
      awayTeam: 'B',
      kickoff: '2026-08-15T15:00:00.000Z',
      closesAt: '2026-08-15T14:00:00.000Z'
    })
  });
  assert.strictEqual(closesBeforeKickoff.status, 400);
  assert.match(closesBeforeKickoff.body.error, /före avspark/);

  const unknown = await call('/api/polls/finns-inte');
  assert.strictEqual(unknown.status, 404);
}));

test('an invalid choice is rejected', () => withApi(async ({ call, author }) => {
  const { body } = await author('/api/polls', {
    method: 'POST',
    body: JSON.stringify({ homeTeam: 'IFK Norrköping', awayTeam: 'Elfsborg' })
  });

  const bad = await call(`/api/polls/${body.poll.id}/votes`, {
    method: 'POST',
    body: JSON.stringify({ choice: '3' })
  });
  assert.strictEqual(bad.status, 400);
}));

test('results are impersonal and cacheable, votes are neither', () =>
  withApi(async ({ call, author }) => {
    const { body } = await author('/api/polls', {
      method: 'POST',
      body: JSON.stringify({ homeTeam: 'IFK Borgholm', awayTeam: 'Rälla IF' })
    });
    const id = body.poll.id;
    const voter = { 'X-Voter-Id': 'e'.repeat(32) };

    const vote = await call(`/api/polls/${id}/votes`, {
      method: 'POST',
      body: JSON.stringify({ choice: '1' }),
      headers: voter
    });
    assert.strictEqual(vote.headers.get('cache-control'), 'no-store');
    assert.strictEqual(vote.body.poll.yourVote, '1');

    // Two readers, one of whom just voted, must get identical results — otherwise
    // a shared cache would hand one reader the other's answer.
    const asVoter = await call(`/api/polls/${id}`, { headers: voter });
    const asStranger = await call(`/api/polls/${id}`);

    assert.match(asVoter.headers.get('cache-control'), /^public, max-age=\d+/);
    assert.strictEqual(asVoter.headers.get('set-cookie'), null);
    assert.deepStrictEqual(asVoter.body, asStranger.body);
    assert.strictEqual(asVoter.body.poll.yourVote, null);
    assert.strictEqual(asVoter.body.poll.counts['1'], 1);

    // The author's own view must never be cached — it sits behind a token.
    const list = await author('/api/polls');
    assert.strictEqual(list.headers.get('cache-control'), 'no-store');
  }));

test('the framing policy is applied when one is configured', async () => {
  const repository = createSqliteRepository({ file: ':memory:' });
  const handle = createHandler({
    repository,
    adminToken: TOKEN,
    frameAncestors: 'https://*.olandsbladet.se'
  });

  const response = await handle(new Request(`${BASE}/api/polls/finns-inte`));
  assert.strictEqual(
    response.headers.get('content-security-policy'),
    'frame-ancestors https://*.olandsbladet.se'
  );
  repository.close();
});
