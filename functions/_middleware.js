// Runs for every request Pages serves, static files included, so the framing
// policy covers the widget itself and not just the API. Set FRAME_ANCESTORS to
// pin embedding to your own domains.

import { withFramePolicy } from '../src/api.js';

export async function onRequest({ request, next, env }) {
  const frameAncestors = env.FRAME_ANCESTORS || null;

  try {
    return withFramePolicy(await next(), frameAncestors);
  } catch (error) {
    // An unhandled error would otherwise surface as Cloudflare's HTML error page,
    // which the widget and the author view can't parse. API callers get JSON.
    console.error(error);
    if (!new URL(request.url).pathname.startsWith('/api/')) throw error;

    return withFramePolicy(new Response(
      JSON.stringify({ error: 'Något gick fel' }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
    ), frameAncestors);
  }
}
