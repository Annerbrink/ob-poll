// Pages Function — /api/oembed
// oEmbed provider so a CMS that only accepts links can embed a poll from its URL.

import { apiFor } from './_lib.js';

export async function onRequestGet(context) {
  return apiFor(context).oembed(context.request);
}
