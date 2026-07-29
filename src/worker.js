import { createHandler, withFramePolicy } from './handler.js';
import { createD1Repository } from './repository-d1.js';

/**
 * Cloudflare entry point. The API is the same handler the local server uses;
 * the widget and the author view are served by Workers Assets, which means
 * static files never wake this Worker at all.
 *
 * Bindings, see wrangler.toml:
 *   DB      – the D1 database
 *   ASSETS  – the files in public/
 * Secrets:
 *   ADMIN_TOKEN      – required, set with `wrangler secret put ADMIN_TOKEN`
 *   FRAME_ANCESTORS  – optional, e.g. https://*.olandsbladet.se
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const frameAncestors = env.FRAME_ANCESTORS || null;

    if (!url.pathname.startsWith('/api/')) {
      return withFramePolicy(await env.ASSETS.fetch(request), frameAncestors);
    }

    if (!env.ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: 'ADMIN_TOKEN saknas' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const handle = createHandler({
      repository: createD1Repository({ database: env.DB }),
      adminToken: env.ADMIN_TOKEN,
      frameAncestors
    });

    return handle(request);
  }
};
