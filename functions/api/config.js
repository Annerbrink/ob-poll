// Pages Function — /api/config
// Publik, tokenlös konfiguration som widgeten behöver (Turnstile-nyckel).

import { apiFor } from './_lib.js';

export async function onRequestGet(context) {
  return apiFor(context).getConfig();
}
