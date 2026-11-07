import { NeonClipRepository } from './clips/neon-clip-repository';
import { ClipService } from './clips/clip-service';
import { AdminSessionService } from './auth/admin-session';
import { parseServerConfig } from './config';
import { createNeonExecutor } from './database/neon';
import { createServerApp } from './http/app';
import { NeonSourceMediaRepository } from './media/neon-source-media-repository';
import { SourceMediaService } from './media/source-media-service';
import { NeonProjectRepository } from './projects/neon-project-repository';
import { ProjectService } from './projects/project-service';
import { ReadinessService } from './readiness';
import { createPrivateObjectStore } from './storage/private-object-store';
import { NeonSourceRepository } from './sources/neon-source-repository';
import { SourceService } from './sources/source-service';

export function createAppFromEnvironment(environment: NodeJS.ProcessEnv) {
  const config = parseServerConfig(environment);
  const database = createNeonExecutor(config.databaseUrl);
  const projectRepository = new NeonProjectRepository(database);
  const sourceRepository = new NeonSourceRepository(database);
  const objectStore = createPrivateObjectStore({
    region: config.awsRegion,
    bucket: config.s3Bucket,
    endpoint: config.s3Endpoint,
    forcePathStyle: config.s3ForcePathStyle,
    credentials: config.awsCredentials,
  });
  const sourceService = new SourceService(sourceRepository, projectRepository);
  const app = createServerApp({
    projects: new ProjectService(projectRepository),
    sources: sourceService,
    media: new SourceMediaService(
      new NeonSourceMediaRepository(database),
      sourceService,
      objectStore,
    ),
    clips: new ClipService(new NeonClipRepository(database), sourceService, objectStore),
    readiness: new ReadinessService(projectRepository, objectStore),
    adminApiToken: config.adminApiToken,
    webOrigin: config.webOrigin,
    adminSession: config.adminLogin
      ? new AdminSessionService({ password: config.adminLogin.password, secret: config.adminLogin.sessionSecret })
      : undefined,
    secureCookies: config.nodeEnv === 'production',
  });
  return { app, config };
}
