'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { CHOICES } = require('../src/choices');
const { createSqliteRepository } = require('../src/repository-sqlite');
const { createD1Repository } = require('../src/repository-d1');
const { fakeD1 } = require('./fake-d1');

/**
 * Both implementations of the data layer have to behave identically, so the same
 * cases run against each. The D1 one runs against a stand-in that speaks D1's
 * API on top of a local SQLite file — it exercises the real SQL and the real
 * batching, but it is not a substitute for a smoke test after deploying.
 */
const implementations = [
  ['sqlite', () => createSqliteRepository({ file: ':memory:' })],
  ['d1', () => createD1Repository({ database: fakeD1() })]
];

for (const [name, create] of implementations) {
  test(`${name}: a poll starts empty and counts the votes cast on it`, async () => {
    const repository = create();
    const poll = await repository.createPoll({ homeTeam: 'IFK Borgholm', awayTeam: 'Rälla IF' });

    assert.deepStrictEqual(poll.counts, { 1: 0, X: 0, 2: 0 });
    assert.strictEqual((await repository.getPoll(poll.id)).homeTeam, 'IFK Borgholm');
    assert.strictEqual(await repository.getPoll('finns-inte'), null);

    await repository.castVote({ pollId: poll.id, voterId: 'a'.repeat(32), choice: '1' });
    await repository.castVote({ pollId: poll.id, voterId: 'b'.repeat(32), choice: '1' });
    await repository.castVote({ pollId: poll.id, voterId: 'c'.repeat(32), choice: '2' });

    assert.deepStrictEqual((await repository.getPoll(poll.id)).counts, { 1: 2, X: 0, 2: 1 });
    assert.strictEqual(await repository.getVote({ pollId: poll.id, voterId: 'a'.repeat(32) }), '1');
    assert.strictEqual(await repository.getVote({ pollId: poll.id, voterId: 'z'.repeat(32) }), null);
  });

  test(`${name}: the stored tally matches a recount however the votes move`, async () => {
    const repository = create();
    const poll = await repository.createPoll({ homeTeam: 'Mörbylånga GoIF', awayTeam: 'GAIS' });
    const voters = Array.from({ length: 12 }, (unused, index) => String(index).padStart(32, '0'));

    for (const [index, voterId] of voters.entries()) {
      await repository.castVote({ pollId: poll.id, voterId, choice: CHOICES[index % 3] });
    }

    // Readers change their minds, some twice, one back to where they started.
    await repository.castVote({ pollId: poll.id, voterId: voters[0], choice: '2' });
    await repository.castVote({ pollId: poll.id, voterId: voters[0], choice: 'X' });
    await repository.castVote({ pollId: poll.id, voterId: voters[1], choice: '1' });
    await repository.castVote({ pollId: poll.id, voterId: voters[1], choice: '1' });
    await repository.castVote({ pollId: poll.id, voterId: voters[7], choice: '1' });

    const stored = (await repository.getPoll(poll.id)).counts;
    assert.deepStrictEqual(stored, await repository.recount(poll.id));
    assert.strictEqual(stored['1'] + stored.X + stored['2'], voters.length);
  });

  test(`${name}: editing a poll keeps its id, votes and tally`, async () => {
    const repository = create();
    const poll = await repository.createPoll({ homeTeam: 'AIK', awayTeam: 'Djurgården', category: 'herr' });
    await repository.castVote({ pollId: poll.id, voterId: 'a'.repeat(32), choice: '1' });

    const updated = await repository.updatePoll(poll.id, {
      homeTeam: 'Hammarby', awayTeam: 'Malmö FF', category: 'dam', kickoff: null, closesAt: null
    });

    assert.strictEqual(updated.id, poll.id);
    assert.strictEqual(updated.homeTeam, 'Hammarby');
    assert.strictEqual(updated.category, 'dam');
    assert.deepStrictEqual(updated.counts, { 1: 1, X: 0, 2: 0 });
    assert.strictEqual(await repository.updatePoll('finns-inte', { homeTeam: 'A', awayTeam: 'B' }), null);
  });

  test(`${name}: deleting a poll takes its votes with it`, async () => {
    const repository = create();
    const poll = await repository.createPoll({ homeTeam: 'GAIS', awayTeam: 'Utsiktens BK' });
    await repository.castVote({ pollId: poll.id, voterId: 'd'.repeat(32), choice: '1' });

    assert.strictEqual(await repository.deletePoll(poll.id), true);
    assert.strictEqual(await repository.getPoll(poll.id), null);
    assert.deepStrictEqual(await repository.recount(poll.id), { 1: 0, X: 0, 2: 0 });
    assert.strictEqual(await repository.deletePoll(poll.id), false);
  });

  test(`${name}: polls are listed newest first`, async () => {
    const repository = create();
    const first = await repository.createPoll({ homeTeam: 'AIK', awayTeam: 'Djurgården' });
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = await repository.createPoll({ homeTeam: 'Hammarby', awayTeam: 'Malmö FF' });

    const listed = (await repository.listPolls()).map(poll => poll.id);
    assert.deepStrictEqual(listed, [second.id, first.id]);
  });
}
