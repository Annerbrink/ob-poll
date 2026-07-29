// Shared wiring for the /api/* Pages Functions.
//
// The endpoints themselves live in src/api.js so that the local server in
// server.js runs exactly the same code. All this does is hand them the D1
// database and the token from the Pages environment.

import { createApi } from '../../src/api.js';
import { createD1Repository } from '../../src/repository-d1.js';

export function apiFor({ env }) {
  return createApi({
    repository: createD1Repository({ database: env.DB }),
    adminToken: env.ADMIN_TOKEN || '',
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
    turnstileSecret: env.TURNSTILE_SECRET || ''
  });
}
