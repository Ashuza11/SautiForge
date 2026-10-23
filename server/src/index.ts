import { serve } from '@hono/node-server';

import { parseServerConfig } from './config';
import { createNeonExecutor } from './database/neon';
import { createServerApp } from './http/app';
import { NeonProjectRepository } from './projects/neon-project-repository';
import { ProjectService } from './projects/project-service';
import { ReadinessService } from './readiness';
import { createPrivateObjectStore } from './storage/private-object-store';

const config = parseServerConfig(process.env);
const projectRepository = new NeonProjectRepository(createNeonExecutor(config.databaseUrl));
const objectStore = createPrivateObjectStore({
  region: config.awsRegion,
  bucket: config.s3Bucket,
  endpoint: config.s3Endpoint,
  forcePathStyle: config.s3ForcePathStyle,
  credentials: config.awsCredentials,
});
const app = createServerApp({
  projects: new ProjectService(projectRepository),
  readiness: new ReadinessService(projectRepository, objectStore),
  adminApiToken: config.adminApiToken,
  webOrigin: config.webOrigin,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`SautiForge API listening on port ${info.port}`);
});
