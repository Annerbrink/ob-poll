'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createSqliteRepository } = require('../src/repository-sqlite');
const { createHandler } = require('../src/handler');
const { pollIdFromUrl } = require('../src/embed');

const TOKEN = 'test-token';
const BASE = 'https://poll.test';

function withApi(run) {
  const repository = createSqliteRepository({ file: ':memory:' });
  const handle = createHandler({ repository, adminToken: TOKEN });

  const raw = (path, options = {}) => handle(new Request(BASE + path, {
    method: options.method || 'GET',
    headers: Object.assign({}, options.headers),
    body: options.body
  }));

  const author = (path, options = {}) => raw(path, {
    ...options,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });

  const createPoll = async () => {
    const res = await author('/api/polls', {
      method: 'POST',
      body: JSON.stringify({ homeTeam: 'Arsenal', awayTeam: 'Tottenham' })
    });
    return (await res.json()).poll.id;
  };

  return run({ raw, createPoll }).finally(() => repository.close());
}

test('pollIdFromUrl reads both the canonical link and the raw widget URL', () => {
  assert.strictEqual(pollIdFromUrl('https://poll.test/p/arsenal-vs-tottenham-abc123'), 'arsenal-vs-tottenham-abc123');
  assert.strictEqual(pollIdFromUrl('https://poll.test/widget.html?poll=arsenal-vs-tottenham-abc123'), 'arsenal-vs-tottenham-abc123');
  assert.strictEqual(pollIdFromUrl('https://poll.test/widget.html'), null);
  assert.strictEqual(pollIdFromUrl('not a url'), null);
});

test('oEmbed returns a rich embed for a poll link', () => withApi(async ({ raw, createPoll }) => {
  const id = await createPoll();
  const url = encodeURIComponent(`${BASE}/p/${id}`);
  const res = await raw(`/api/oembed?url=${url}&format=json`);

  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();

  assert.strictEqual(body.version, '1.0');
  assert.strictEqual(body.type, 'rich');
  assert.strictEqual(body.title, 'Arsenal – Tottenham');
  assert.ok(body.width > 0 && body.height > 0);
  assert.match(body.html, /<iframe/);
  assert.ok(body.html.includes(`/widget.html?poll=${id}`), 'iframe points at the widget');
}));

test('oEmbed accepts the raw widget URL too', () => withApi(async ({ raw, createPoll }) => {
  const id = await createPoll();
  const url = encodeURIComponent(`${BASE}/widget.html?poll=${id}`);
  const res = await raw(`/api/oembed?url=${url}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).type, 'rich');
}));

test('oEmbed maxwidth shrinks the embed', () => withApi(async ({ raw, createPoll }) => {
  const id = await createPoll();
  const url = encodeURIComponent(`${BASE}/p/${id}`);
  const body = await (await raw(`/api/oembed?url=${url}&maxwidth=300`)).json();
  assert.strictEqual(body.width, 300);
  assert.ok(body.html.includes('max-width:300px'));
}));

test('oEmbed rejects unknown polls, bad urls and unsupported formats', () => withApi(async ({ raw, createPoll }) => {
  await createPoll();
  assert.strictEqual((await raw(`/api/oembed?url=${encodeURIComponent(BASE + '/p/nope-000000')}`)).status, 404);
  assert.strictEqual((await raw('/api/oembed')).status, 400);
  assert.strictEqual((await raw(`/api/oembed?url=${encodeURIComponent(BASE + '/p/x')}&format=xml`)).status, 501);
}));

test('the poll page carries oEmbed discovery and Open Graph tags', () => withApi(async ({ raw, createPoll }) => {
  const id = await createPoll();
  const res = await raw(`/p/${id}`);

  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();

  assert.ok(html.includes('application/json+oembed'), 'has the oEmbed discovery link');
  assert.ok(html.includes(`/api/oembed?url=${encodeURIComponent(BASE + '/p/' + id)}`), 'discovery points back at itself');
  assert.match(html, /property="og:title" content="Arsenal – Tottenham"/);
  assert.ok(html.includes(`/widget.html?poll=${id}`), 'shows the poll itself');
}));

test('the poll page 404s for an unknown poll', () => withApi(async ({ raw }) => {
  const res = await raw('/p/does-not-exist-000000');
  assert.strictEqual(res.status, 404);
}));
