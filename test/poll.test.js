'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createRepository, CHOICES } = require('../src/repository');
const { createApp } = require('../src/app');
const { toPercentages } = require('../src/results');

const TOKEN = 'test-token';

function withServer(run) {
  const repository = createRepository({ file: ':memory:' });
  const app = createApp({ repository, adminToken: TOKEN });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (path, options = {}) => {
    const response = await fetch(base + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const body = response.status === 204 ? null : await response.json();
    return { status: response.status, body };
  };

  const author = (path, options = {}) =>
    call(path, { ...options, headers: { Authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) } });

  return run({ call, author })
    .finally(() => { server.close(); repository.close(); });
}

test('percentages always add up to 100', () => {
  assert.deepStrictEqual(toPercentages({ 1: 1, X: 1, 2: 1 }), { 1: 34, X: 33, 2: 33 });
  assert.deepStrictEqual(toPercentages({ 1: 0, X: 0, 2: 0 }), { 1: 0, X: 0, 2: 0 });

  for (const counts of [{ 1: 47, X: 12, 2: 28 }, { 1: 1, X: 2, 2: 0 }, { 1: 5, X: 5, 2: 5 }]) {
    const pct = toPercentages(counts);
    assert.strictEqual(pct['1'] + pct.X + pct['2'], 100, JSON.stringify(counts));
  }
});

test('an author creates a poll and readers vote on it', () => withServer(async ({ call, author }) => {
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

test('a reader changing their mind moves the vote instead of adding one', () =>
  withServer(async ({ call, author }) => {
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

test('results survive a restart because they live in the data layer', () => {
  const file = `${__dirname}/../data/test-${Date.now()}.db`;

  const first = createRepository({ file });
  const poll = first.createPoll({ homeTeam: 'Hammarby', awayTeam: 'Malmö FF' });
  first.castVote({ pollId: poll.id, voterId: 'x'.repeat(32), choice: 'X' });
  first.close();

  const second = createRepository({ file });
  assert.deepStrictEqual(second.getPoll(poll.id).counts, { 1: 0, X: 1, 2: 0 });
  assert.strictEqual(second.getPoll(poll.id).homeTeam, 'Hammarby');
  second.close();

  for (const suffix of ['', '-wal', '-shm']) {
    require('node:fs').rmSync(file + suffix, { force: true });
  }
});

test('voting is rejected once the poll has closed', () => withServer(async ({ call, author }) => {
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

test('poll creation requires the author token and valid input', () => withServer(async ({ call, author }) => {
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

  const unknown = await call('/api/polls/finns-inte');
  assert.strictEqual(unknown.status, 404);
}));

test('an invalid choice is rejected', () => withServer(async ({ call, author }) => {
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

test('the stored tally matches a recount however the votes move', () => {
  const repository = createRepository({ file: ':memory:' });
  const poll = repository.createPoll({ homeTeam: 'IFK Borgholm', awayTeam: 'Rälla IF' });
  const voters = Array.from({ length: 12 }, (unused, index) => String(index).padStart(32, '0'));

  voters.forEach((voterId, index) => {
    repository.castVote({ pollId: poll.id, voterId, choice: CHOICES[index % 3] });
  });

  // Readers change their minds, some more than once, some back to where they started.
  repository.castVote({ pollId: poll.id, voterId: voters[0], choice: '2' });
  repository.castVote({ pollId: poll.id, voterId: voters[0], choice: 'X' });
  repository.castVote({ pollId: poll.id, voterId: voters[1], choice: '1' });
  repository.castVote({ pollId: poll.id, voterId: voters[1], choice: '1' });
  repository.castVote({ pollId: poll.id, voterId: voters[7], choice: '1' });

  const stored = repository.getPoll(poll.id).counts;
  assert.deepStrictEqual(stored, repository.recount(poll.id));
  assert.strictEqual(stored['1'] + stored.X + stored['2'], voters.length);
  repository.close();
});

test('deleting a poll takes its votes with it', () => {
  const repository = createRepository({ file: ':memory:' });
  const poll = repository.createPoll({ homeTeam: 'GAIS', awayTeam: 'Utsiktens BK' });
  repository.castVote({ pollId: poll.id, voterId: 'd'.repeat(32), choice: '1' });

  assert.strictEqual(repository.deletePoll(poll.id), true);
  assert.strictEqual(repository.getPoll(poll.id), null);
  assert.deepStrictEqual(repository.recount(poll.id), { 1: 0, X: 0, 2: 0 });
  repository.close();
});
