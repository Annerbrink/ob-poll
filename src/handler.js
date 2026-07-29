'use strict';

const { createApi, withFramePolicy } = require('./api');

/**
 * Path routing for the local server. On Cloudflare the same endpoints are
 * reached through the files in functions/, which Pages maps to paths for us —
 * this is the one place where the two deployments differ.
 */
function createHandler({ repository, adminToken, frameAncestors = null, turnstileSiteKey = '', turnstileSecret = '' }) {
  const api = createApi({ repository, adminToken, turnstileSiteKey, turnstileSecret });

  async function route(request) {
    const { pathname } = new URL(request.url);
    const method = request.method;

    if (pathname === '/api/config') {
      return method === 'GET' ? api.getConfig() : api.methodNotAllowed();
    }

    if (pathname === '/api/polls') {
      const denied = api.requireAuthor(request);
      if (denied) return denied;

      if (method === 'POST') return api.createPoll(request);
      if (method === 'GET') return api.listPolls();
      return api.methodNotAllowed();
    }

    const single = pathname.match(/^\/api\/polls\/([^/]+)$/);
    if (single) {
      const id = decodeURIComponent(single[1]);
      if (method === 'GET') return api.showPoll(id);
      if (method === 'PUT') {
        const denied = api.requireAuthor(request);
        return denied || api.updatePoll(request, id);
      }
      if (method === 'DELETE') {
        const denied = api.requireAuthor(request);
        return denied || api.deletePoll(id);
      }
      return api.methodNotAllowed();
    }

    const votes = pathname.match(/^\/api\/polls\/([^/]+)\/votes$/);
    if (votes) {
      const id = decodeURIComponent(votes[1]);
      if (method === 'POST') return api.castVote(request, id);
      if (method === 'DELETE') return api.retractVote(request, id);
      return api.methodNotAllowed();
    }

    return api.notFound();
  }

  return async function handle(request) {
    return withFramePolicy(await route(request), frameAncestors);
  };
}

module.exports = { createHandler };
