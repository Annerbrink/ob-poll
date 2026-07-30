// Pages Function — /p/:id
// The canonical poll link an editor pastes: carries oEmbed discovery + Open
// Graph tags and shows the poll when opened directly.

import { apiFor } from '../api/_lib.js';

export async function onRequestGet(context) {
  return apiFor(context).pollPage(context.request, context.params.id);
}
