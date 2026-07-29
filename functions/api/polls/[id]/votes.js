// Pages Function — /api/polls/:id/votes
// Läsarens röst. Aldrig cachad, till skillnad från resultatet.

import { apiFor } from '../../_lib.js';

export async function onRequestPost(context) {
  return apiFor(context).castVote(context.request, context.params.id);
}
