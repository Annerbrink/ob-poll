'use strict';

const { CHOICES } = require('./choices');
const { present, isClosed } = require('./results');

const MAX_TEAM_LENGTH = 60;
const RESULT_CACHE_SECONDS = 15;
const MAX_BODY_BYTES = 8192;

/**
 * The API, written against the Web platform's Request and Response so the same
 * code runs behind node:http locally and inside a Cloudflare Worker in
 * production. Nothing in here touches a Node built-in.
 */
function createHandler({ repository, adminToken, frameAncestors = null }) {
  function json(status, body, headers) {
    return new Response(JSON.stringify(body), {
      status,
      headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers)
    });
  }

  function isAuthor(request) {
    const header = request.headers.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return safeEqual(token, adminToken);
  }

  /**
   * Readers are identified by an opaque id kept in the widget's localStorage and
   * mirrored to a cookie. Third-party cookies are blocked in framed contexts on
   * most browsers, so the header is the one that actually carries across embeds.
   * It stops accidental double voting, not a determined ballot stuffer.
   *
   * Only the vote endpoint needs it — results are the same for every reader,
   * which is what lets them be cached.
   */
  function resolveVoterId(request) {
    const supplied = request.headers.get('x-voter-id') || readCookie(request, 'voterId');
    return /^[a-f0-9]{32}$/.test(supplied || '') ? supplied : randomId();
  }

  async function readBody(request) {
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_BODY_BYTES) return null;

    try {
      const body = await request.json();
      return body && typeof body === 'object' ? body : null;
    } catch (error) {
      return null;
    }
  }

  async function createPoll(request) {
    const body = await readBody(request);
    if (!body) return json(400, { error: 'Ogiltig begäran' });

    const homeTeam = cleanTeam(body.homeTeam);
    const awayTeam = cleanTeam(body.awayTeam);

    if (!homeTeam || !awayTeam) {
      return json(400, { error: 'Båda lagnamnen måste fyllas i' });
    }
    if (homeTeam.length > MAX_TEAM_LENGTH || awayTeam.length > MAX_TEAM_LENGTH) {
      return json(400, { error: `Lagnamn får vara högst ${MAX_TEAM_LENGTH} tecken` });
    }

    const kickoff = cleanTimestamp(body.kickoff);
    if (kickoff === false) return json(400, { error: 'Avsparkstiden är inte ett giltigt datum' });

    const closesAt = cleanTimestamp(body.closesAt);
    if (closesAt === false) return json(400, { error: 'Stängningstiden är inte ett giltigt datum' });

    const poll = await repository.createPoll({
      homeTeam,
      awayTeam,
      kickoff,
      // Voting stops at kickoff unless the author says otherwise.
      closesAt: closesAt || kickoff,
      createdBy: cleanTeam(body.createdBy) || null
    });

    return json(201, { poll });
  }

  async function listPolls() {
    const polls = (await repository.listPolls()).map(poll => ({
      ...present(poll, null),
      createdBy: poll.createdBy,
      createdAt: poll.createdAt
    }));
    return json(200, { polls });
  }

  /**
   * Deliberately impersonal: no reader id, no cookie, nothing that varies between
   * two readers. That is what makes it cacheable — at the edge as well as in the
   * browser — so a match that takes off costs one origin request per interval
   * rather than one per reader. The widget remembers the reader's own sign itself.
   */
  async function showPoll(id) {
    const poll = await repository.getPoll(id);
    if (!poll) return json(404, { error: 'Omröstningen finns inte' });

    return json(200, { poll: present(poll, null) }, {
      'Cache-Control': `public, max-age=${RESULT_CACHE_SECONDS}, stale-while-revalidate=30`
    });
  }

  async function castVote(request, id) {
    const poll = await repository.getPoll(id);
    if (!poll) return json(404, { error: 'Omröstningen finns inte' });

    const body = await readBody(request);
    const choice = body && body.choice;
    if (!CHOICES.includes(choice)) {
      return json(400, { error: 'Valet måste vara "1", "X" eller "2"' });
    }
    if (isClosed(poll)) {
      return json(409, { error: 'Omröstningen är stängd för den här matchen' });
    }

    const voterId = resolveVoterId(request);
    await repository.castVote({ pollId: poll.id, voterId, choice });

    return json(200, { voterId, poll: present(await repository.getPoll(poll.id), choice) }, {
      'Set-Cookie': `voterId=${voterId}; Path=/; Max-Age=31536000; SameSite=None; Secure`
    });
  }

  async function route(request) {
    const { pathname } = new URL(request.url);
    const method = request.method;

    if (pathname === '/api/polls') {
      if (!isAuthor(request)) return json(401, { error: 'Skribenttoken krävs' });
      if (method === 'POST') return createPoll(request);
      if (method === 'GET') return listPolls();
      return json(405, { error: 'Metoden stöds inte' });
    }

    const single = pathname.match(/^\/api\/polls\/([^/]+)$/);
    if (single) {
      const id = decodeURIComponent(single[1]);
      if (method === 'GET') return showPoll(id);
      if (method === 'DELETE') {
        if (!isAuthor(request)) return json(401, { error: 'Skribenttoken krävs' });
        return (await repository.deletePoll(id))
          ? new Response(null, { status: 204 })
          : json(404, { error: 'Omröstningen finns inte' });
      }
      return json(405, { error: 'Metoden stöds inte' });
    }

    const votes = pathname.match(/^\/api\/polls\/([^/]+)\/votes$/);
    if (votes) {
      if (method !== 'POST') return json(405, { error: 'Metoden stöds inte' });
      return castVote(request, decodeURIComponent(votes[1]));
    }

    return json(404, { error: 'Hittades inte' });
  }

  return async function handle(request) {
    const response = await route(request);

    // Everything but the cacheable results response must stay out of caches:
    // one carries the author's token, the other the reader's own vote.
    if (!response.headers.has('Cache-Control')) {
      response.headers.set('Cache-Control', 'no-store');
    }
    if (frameAncestors) {
      response.headers.set('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
    }
    return response;
  };
}

/** Adds the framing policy to a static asset response. */
function withFramePolicy(response, frameAncestors) {
  if (!frameAncestors) return response;

  const copy = new Response(response.body, response);
  copy.headers.set('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
  return copy;
}

function cleanTeam(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

/** Returns an ISO string, null when empty, or false when unparseable. */
function cleanTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? false : date.toISOString();
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  const match = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Comparison that does not leak how much of the token was right. */
function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;

  let differences = 0;
  for (let i = 0; i < left.length; i++) differences |= left[i] ^ right[i];
  return differences === 0;
}

module.exports = { createHandler, withFramePolicy };
