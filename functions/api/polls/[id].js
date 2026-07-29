// Pages Function — /api/polls/:id
// Resultatet som läsarna hämtar, och skribentens borttagning.

import { apiFor } from '../_lib.js';

export async function onRequestGet(context) {
  return apiFor(context).showPoll(context.params.id);
}

export async function onRequestPut(context) {
  const api = apiFor(context);
  return api.requireAuthor(context.request) || api.updatePoll(context.request, context.params.id);
}

export async function onRequestDelete(context) {
  const api = apiFor(context);
  return api.requireAuthor(context.request) || api.deletePoll(context.params.id);
}
