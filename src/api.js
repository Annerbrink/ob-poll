'use strict';

const { CHOICES } = require('./choices');
const { present, isClosed } = require('./results');

const MAX_TEAM_LENGTH = 60;
const RESULT_CACHE_SECONDS = 15;
const MAX_BODY_BYTES = 8192;

/** A poll is either a men's or a women's fixture — or unspecified (null). */
const CATEGORIES = ['herr', 'dam'];

/**
 * The endpoints, written against the Web platform's Request and Response so the
 * same code runs behind node:http locally and as Pages Functions on Cloudflare.
 * Nothing in here touches a Node built-in, and nothing in here knows how the
 * request was routed — functions/ maps paths to these, src/handler.js does the
 * same for the local server.
 */
function createApi({ repository, adminToken, turnstileSiteKey = '', turnstileSecret = '' }) {
  return {
    /** Returns a 401 response when the caller is not an author, otherwise null. */
    requireAuthor(request) {
      const header = request.headers.get('authorization') || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      return safeEqual(token, adminToken) ? null : json(401, { error: 'Skribenttoken krävs' });
    },

    /**
     * Public, tokenless config the widget needs before it can render — currently
     * only the Turnstile site key. Empty when no bot protection is configured.
     */
    getConfig() {
      return json(200, { turnstileSiteKey }, {
        'Cache-Control': `public, max-age=${RESULT_CACHE_SECONDS}`
      });
    },

    async createPoll(request) {
      const body = await readBody(request);
      const { error, fields } = readFixture(body);
      if (error) return error;

      const poll = await repository.createPoll({
        ...fields,
        createdBy: cleanTeam(body.createdBy) || null
      });

      return json(201, { poll });
    },

    async listPolls() {
      const polls = (await repository.listPolls()).map(poll => ({
        ...present(poll, null),
        createdBy: poll.createdBy,
        createdAt: poll.createdAt
      }));
      return json(200, { polls });
    },

    /**
     * Deliberately impersonal: no reader id, no cookie, nothing that varies between
     * two readers. That is what makes it cacheable — at the edge as well as in the
     * browser — so a match that takes off costs one origin request per interval
     * rather than one per reader. The widget remembers the reader's own sign itself.
     */
    async showPoll(id) {
      const poll = await repository.getPoll(id);
      if (!poll) return json(404, { error: 'Omröstningen finns inte' });

      return json(200, { poll: present(poll, null) }, {
        'Cache-Control': `public, max-age=${RESULT_CACHE_SECONDS}, stale-while-revalidate=30`
      });
    },

    /** The author edits an existing poll; the id and its votes stay put. */
    async updatePoll(request, id) {
      if (!(await repository.getPoll(id))) return json(404, { error: 'Omröstningen finns inte' });

      const { error, fields } = readFixture(await readBody(request));
      if (error) return error;

      return json(200, { poll: present(await repository.updatePoll(id, fields), null) });
    },

    async deletePoll(id) {
      return (await repository.deletePoll(id))
        ? new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
        : json(404, { error: 'Omröstningen finns inte' });
    },

    async castVote(request, id) {
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

      // Only enforced when a secret is configured, so local and unprotected
      // deployments keep working exactly as before.
      if (turnstileSecret) {
        const ip = request.headers.get('cf-connecting-ip');
        if (!await verifyTurnstile(turnstileSecret, body.turnstileToken, ip)) {
          return json(403, { error: 'Verifieringen misslyckades, ladda om och försök igen' });
        }
      }

      const voterId = resolveVoterId(request);
      await repository.castVote({ pollId: poll.id, voterId, choice });

      return json(200, { voterId, poll: present(await repository.getPoll(poll.id), choice) }, {
        'Set-Cookie': `voterId=${voterId}; Path=/; Max-Age=31536000; SameSite=None; Secure`
      });
    },

    /** Lets a reader take back their vote while the poll is still open. */
    async retractVote(request, id) {
      const poll = await repository.getPoll(id);
      if (!poll) return json(404, { error: 'Omröstningen finns inte' });
      if (isClosed(poll)) {
        return json(409, { error: 'Omröstningen är stängd för den här matchen' });
      }

      const voterId = resolveVoterId(request);
      await repository.removeVote({ pollId: poll.id, voterId });

      return json(200, { voterId, poll: present(await repository.getPoll(poll.id), null) }, {
        'Set-Cookie': `voterId=${voterId}; Path=/; Max-Age=31536000; SameSite=None; Secure`
      });
    },

    methodNotAllowed() {
      return json(405, { error: 'Metoden stöds inte' });
    },

    notFound() {
      return json(404, { error: 'Hittades inte' });
    }
  };
}

/**
 * Everything but the results response must stay out of caches: one carries the
 * author's token, the other the reader's own vote.
 */
function json(status, body, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      headers
    )
  });
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

/**
 * Validates the fixture fields shared by create and update. Returns either
 * `{ error }` with a ready 400 Response, or `{ fields }` with cleaned values.
 */
function readFixture(body) {
  if (!body) return { error: json(400, { error: 'Ogiltig begäran' }) };

  const homeTeam = cleanTeam(body.homeTeam);
  const awayTeam = cleanTeam(body.awayTeam);
  if (!homeTeam || !awayTeam) {
    return { error: json(400, { error: 'Båda lagnamnen måste fyllas i' }) };
  }
  if (homeTeam.length > MAX_TEAM_LENGTH || awayTeam.length > MAX_TEAM_LENGTH) {
    return { error: json(400, { error: `Lagnamn får vara högst ${MAX_TEAM_LENGTH} tecken` }) };
  }

  const kickoff = cleanTimestamp(body.kickoff);
  if (kickoff === false) return { error: json(400, { error: 'Avsparkstiden är inte ett giltigt datum' }) };

  const closesAt = cleanTimestamp(body.closesAt);
  if (closesAt === false) return { error: json(400, { error: 'Stängningstiden är inte ett giltigt datum' }) };

  if (kickoff && closesAt && new Date(closesAt) < new Date(kickoff)) {
    return { error: json(400, { error: 'Stängningstiden kan inte vara före avspark' }) };
  }

  return {
    fields: {
      homeTeam,
      awayTeam,
      kickoff,
      // Voting stops at kickoff unless the author says otherwise.
      closesAt: closesAt || kickoff,
      category: cleanCategory(body.category)
    }
  };
}

function cleanTeam(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

/** Anything the author didn't pick from the two allowed values becomes null. */
function cleanCategory(value) {
  return CATEGORIES.includes(value) ? value : null;
}

/** Returns an ISO string, null when empty, or false when unparseable. */
function cleanTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? false : date.toISOString();
}

/**
 * Verifies a Cloudflare Turnstile token against the siteverify endpoint. Any
 * missing token, network hiccup or unparseable answer counts as a failure, so a
 * configured poll never lets a vote through unchecked.
 */
async function verifyTurnstile(secret, token, ip) {
  if (!token || typeof token !== 'string') return false;

  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip) form.set('remoteip', ip);

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form
    });
    const result = await response.json();
    return Boolean(result && result.success);
  } catch (error) {
    return false;
  }
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

module.exports = { createApi, withFramePolicy };

/** Adds the framing policy to a response, static assets included. */
function withFramePolicy(response, frameAncestors) {
  if (!frameAncestors) return response;

  const copy = new Response(response.body, response);
  copy.headers.set('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
  return copy;
}
