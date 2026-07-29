// Pages Function — /api/polls
// Skribentens endpoints: skapa en omröstning och lista de befintliga.

import { apiFor } from '../_lib.js';

export async function onRequestPost(context) {
  const api = apiFor(context);
  return api.requireAuthor(context.request) || api.createPoll(context.request);
}

export async function onRequestGet(context) {
  const api = apiFor(context);
  return api.requireAuthor(context.request) || api.listPolls();
}
