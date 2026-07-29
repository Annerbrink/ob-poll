'use strict';

/**
 * Local entry point: node:http in front of the shared handler, plus a small
 * static file server for public/. On Cloudflare the same handler runs from
 * src/worker.js and the assets are served by the platform.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const { createSqliteRepository } = require('./src/repository-sqlite');
const { createHandler } = require('./src/handler');

const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
};

const port = Number(process.env.PORT) || 3000;
const adminToken = process.env.ADMIN_TOKEN || randomToken();
const frameAncestors = process.env.FRAME_ANCESTORS || null;

const repository = createSqliteRepository({ file: process.env.DATABASE_FILE });
const handle = createHandler({
  repository,
  adminToken,
  frameAncestors,
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
  turnstileSecret: process.env.TURNSTILE_SECRET || ''
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    toWebRequest(req, url)
      .then(handle)
      .then(response => send(res, response))
      .catch(error => {
        console.error(error);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Något gick fel' }));
      });
    return;
  }

  serveStatic(url.pathname, res);
});

server.listen(port, () => {
  console.log(`1X2-omröstning: http://localhost:${port}`);
  console.log(`Skribentvy:     http://localhost:${port}/skribent.html`);
  if (!process.env.ADMIN_TOKEN) {
    console.log(`\nADMIN_TOKEN är inte satt. Tillfällig token för den här sessionen:\n  ${adminToken}`);
  }
});

async function toWebRequest(req, url) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);

  return new Request(url, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined
  });
}

async function send(res, response) {
  const body = Buffer.from(await response.arrayBuffer());
  const headers = {};
  response.headers.forEach((value, key) => { headers[key] = value; });

  res.writeHead(response.status, headers);
  res.end(body);
}

function serveStatic(pathname, res) {
  const relative = pathname === '/' ? 'widget.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC, relative);

  // Nothing outside public/ is servable, whatever the path claims to be.
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403).end();
    return;
  }

  fs.readFile(file, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Hittades inte');
      return;
    }

    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' };
    if (frameAncestors) headers['Content-Security-Policy'] = `frame-ancestors ${frameAncestors}`;

    res.writeHead(200, headers);
    res.end(content);
  });
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}
