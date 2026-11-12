import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';

import { AdminSessionService } from '../auth/admin-session';
import { BatchService } from '../batches/batch-service';
import { FinalService } from '../finals/final-service';
import { NeonFinalRepository } from '../finals/neon-final-repository';
import { ResultsService } from '../results/results-service';
import { NeonVolunteerRepository } from '../volunteer/neon-volunteer-repository';
import { VolunteerService } from '../volunteer/volunteer-service';
import { NeonBatchRepository } from '../batches/neon-batch-repository';
import { ClipService } from '../clips/clip-service';
import { NeonClipRepository } from '../clips/neon-clip-repository';
import { createServerApp } from '../http/app';
import { NeonSourceMediaRepository } from '../media/neon-source-media-repository';
import { SourceMediaService } from '../media/source-media-service';
import { NeonProjectRepository } from '../projects/neon-project-repository';
import { ProjectService } from '../projects/project-service';
import { ReadinessService } from '../readiness';
import { NeonSourceRepository } from '../sources/neon-source-repository';
import { SourceService } from '../sources/source-service';
import { DiskObjectStore } from './disk-object-store';
import { createPgliteExecutor } from './pglite-executor';

export type LocalServerOptions = {
  /** Folder for the database and stored audio; omit for a throwaway in-memory database. */
  dataDirectory?: string;
  webOrigin: string;
  publicBaseUrl: string;
  adminApiToken: string;
  adminPassword: string;
  sessionSecret: string;
};

export type LocalServer = {
  app: Hono;
  database: PGlite;
  projects: ProjectService;
  sources: SourceService;
  objectStore: DiskObjectStore;
};

const migrationDirectory = path.resolve(import.meta.dirname, '../../migrations');

export async function createLocalServer(options: LocalServerOptions): Promise<LocalServer> {
  const database = new PGlite(options.dataDirectory ? path.join(options.dataDirectory, 'db') : undefined);
  await database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
  const applied = new Set((await database.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((row) => row.name));
  for (const file of (await readdir(migrationDirectory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    if (applied.has(file)) continue;
    await database.exec(await readFile(path.join(migrationDirectory, file), 'utf8'));
    await database.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
  }

  const executor = createPgliteExecutor(database);
  const projectRepository = new NeonProjectRepository(executor);
  const projects = new ProjectService(projectRepository);
  const sources = new SourceService(new NeonSourceRepository(executor), projectRepository);
  const objectStore = new DiskObjectStore(
    path.join(options.dataDirectory ?? path.resolve('.local-data'), 'storage'),
    options.publicBaseUrl,
    options.sessionSecret,
  );
  const clipRepository = new NeonClipRepository(executor);
  const batchRepository = new NeonBatchRepository(executor);
  const volunteerRepository = new NeonVolunteerRepository(executor);
  const finalRepository = new NeonFinalRepository(executor);
  const clipService = new ClipService(clipRepository, sources, objectStore);
  const batchService = new BatchService(batchRepository, sources, { linkSecret: options.sessionSecret });
  const api = createServerApp({
    projects,
    sources,
    media: new SourceMediaService(new NeonSourceMediaRepository(executor), sources, objectStore),
    clips: clipService,
    batches: batchService,
    results: new ResultsService(batchRepository, clipRepository, volunteerRepository, finalRepository, (batchId) => batchService.tokenFor(batchId)),
    finals: new FinalService(finalRepository, clipRepository, volunteerRepository, sources, projects, objectStore),
    volunteer: new VolunteerService(volunteerRepository, batchService, clipService, projects, sources, { linkSecret: options.sessionSecret }),
    readiness: new ReadinessService(projectRepository, objectStore),
    adminApiToken: options.adminApiToken,
    webOrigin: options.webOrigin,
    adminSession: new AdminSessionService({ password: options.adminPassword, secret: options.sessionSecret }),
    secureCookies: false,
  });
  const app = new Hono();
  app.route('/local-storage', objectStore.routes());
  app.route('/', api);
  return { app, database, projects, sources, objectStore };
}
