import { serve } from '@hono/node-server';

import { createAppFromEnvironment } from './create-app';

const { app, config } = createAppFromEnvironment(process.env);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`SautiForge API listening on port ${info.port}`);
});
