'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');

const { CHOICES } = require('./repository');
const { present, isClosed } = require('./results');

const MAX_TEAM_LENGTH = 60;

function createApp({ repository, adminToken, frameAncestors = null }) {
  const app = express();

  app.use(express.json({ limit: '8kb' }));
  app.disable('x-powered-by');

  // The widget is meant to be framed by the newspaper's article pages. Set
  // FRAME_ANCESTORS to pin that to your own domains instead of allowing anyone.
  if (frameAncestors) {
    app.use((req, res, next) => {
      res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
      next();
    });
  }

  app.use(express.static(path.join(__dirname, '..', 'public')));

  function requireAuthor(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!safeEqual(token, adminToken)) {
      return res.status(401).json({ error: 'Skribenttoken krävs' });
    }
    next();
  }

  /**
   * Readers are identified by an opaque id kept in the widget's localStorage and
   * mirrored to a cookie. Third-party cookies are blocked in framed contexts on
   * most browsers, so the header is the one that actually carries across embeds.
   * It stops accidental double voting, not a determined ballot stuffer.
   */
  function resolveVoterId(req, res) {
    const supplied = req.get('x-voter-id') || readCookie(req, 'voterId');
    const voterId = /^[a-f0-9]{32}$/.test(supplied || '')
      ? supplied
      : crypto.randomBytes(16).toString('hex');

    res.setHeader(
      'Set-Cookie',
      `voterId=${voterId}; Path=/; Max-Age=31536000; SameSite=None; Secure`
    );
    return voterId;
  }

  app.post('/api/polls', requireAuthor, (req, res) => {
    const homeTeam = cleanTeam(req.body.homeTeam);
    const awayTeam = cleanTeam(req.body.awayTeam);

    if (!homeTeam || !awayTeam) {
      return res.status(400).json({ error: 'Båda lagnamnen måste fyllas i' });
    }
    if (homeTeam.length > MAX_TEAM_LENGTH || awayTeam.length > MAX_TEAM_LENGTH) {
      return res.status(400).json({ error: `Lagnamn får vara högst ${MAX_TEAM_LENGTH} tecken` });
    }

    const kickoff = cleanTimestamp(req.body.kickoff);
    if (kickoff === false) return res.status(400).json({ error: 'Avsparkstiden är inte ett giltigt datum' });

    const closesAt = cleanTimestamp(req.body.closesAt);
    if (closesAt === false) return res.status(400).json({ error: 'Stängningstiden är inte ett giltigt datum' });

    const poll = repository.createPoll({
      homeTeam,
      awayTeam,
      kickoff,
      // Voting stops at kickoff unless the author says otherwise.
      closesAt: closesAt || kickoff,
      createdBy: cleanTeam(req.body.createdBy) || null
    });

    res.status(201).json({ poll });
  });

  app.get('/api/polls', requireAuthor, (req, res) => {
    const polls = repository.listPolls().map(poll => {
      const counts = repository.getTally(poll.id);
      return { ...present(poll, counts, null), createdBy: poll.createdBy, createdAt: poll.createdAt };
    });
    res.json({ polls });
  });

  app.delete('/api/polls/:id', requireAuthor, (req, res) => {
    if (!repository.deletePoll(req.params.id)) {
      return res.status(404).json({ error: 'Omröstningen finns inte' });
    }
    res.status(204).end();
  });

  app.get('/api/polls/:id', (req, res) => {
    const poll = repository.getPoll(req.params.id);
    if (!poll) return res.status(404).json({ error: 'Omröstningen finns inte' });

    const voterId = resolveVoterId(req, res);
    res.json({
      voterId,
      poll: present(poll, repository.getTally(poll.id), repository.getVote({ pollId: poll.id, voterId }))
    });
  });

  app.post('/api/polls/:id/votes', (req, res) => {
    const poll = repository.getPoll(req.params.id);
    if (!poll) return res.status(404).json({ error: 'Omröstningen finns inte' });

    const choice = req.body && req.body.choice;
    if (!CHOICES.includes(choice)) {
      return res.status(400).json({ error: 'Valet måste vara "1", "X" eller "2"' });
    }
    if (isClosed(poll)) {
      return res.status(409).json({ error: 'Omröstningen är stängd för den här matchen' });
    }

    const voterId = resolveVoterId(req, res);
    repository.castVote({ pollId: poll.id, voterId, choice });

    res.json({
      voterId,
      poll: present(poll, repository.getTally(poll.id), choice)
    });
  });

  return app;
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

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = { createApp };
