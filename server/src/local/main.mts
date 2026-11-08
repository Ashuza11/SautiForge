import path from 'node:path';

import { serve } from '@hono/node-server';

import { createLocalServer } from './local-server';
import { seedLocalData } from './seed';

if (process.env.NODE_ENV === 'production') throw new Error('Local mode must never run in production.');

const port = Number(process.env.PORT ?? 8787);
const webOrigin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:4173';
const dataDirectory = process.argv.includes('--memory') ? undefined : path.resolve(process.env.LOCAL_DATA_DIR ?? '.local-data');
const adminApiToken = 'local-dev-admin-token-not-a-secret-0001';
const adminPassword = 'local-admin-password';

const server = await createLocalServer({
  dataDirectory,
  webOrigin,
  publicBaseUrl: `http://127.0.0.1:${port}`,
  adminApiToken,
  adminPassword,
  sessionSecret: 'local-dev-session-secret-not-a-secret-0001',
});
const seed = await seedLocalData(server);

serve({ fetch: server.app.fetch, hostname: '127.0.0.1', port }, () => {
  console.log(`SautiForge LOCAL server on http://127.0.0.1:${port}  (${dataDirectory ? `data in ${dataDirectory}` : 'in-memory'})`);
  console.log(`  web origin:      ${webOrigin}`);
  console.log(`  admin password:  ${adminPassword}`);
  console.log(`  admin API token: ${adminApiToken}`);
  console.log(`  source id:       ${seed.sourceId}${seed.created ? '  (just created)' : ''}`);
});
