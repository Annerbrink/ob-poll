// Runs for every request Pages serves, static files included, so the framing
// policy covers the widget itself and not just the API. Set FRAME_ANCESTORS to
// pin embedding to your own domains.

import { withFramePolicy } from '../src/api.js';

export async function onRequest({ next, env }) {
  return withFramePolicy(await next(), env.FRAME_ANCESTORS || null);
}
