import { timingSafeEqual } from 'node:crypto';

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { z } from 'zod';

import { projectDraftSchema } from '../../../src/features/projects/domain/project';
import type { ProjectService } from '../projects/project-service';
import type { ReadinessService } from '../readiness';

export type AppDependencies = {
  projects: ProjectService;
  readiness: ReadinessService;
  adminApiToken: string;
  webOrigin: string;
};

const projectIdSchema = z.string().uuid();

export function createServerApp(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.get('/health', (context) => context.json({ status: 'ok' }));

  app.use('/v1/*', async (context, next) => {
    const requestOrigin = context.req.header('Origin');
    if (requestOrigin && requestOrigin !== dependencies.webOrigin) {
      return context.json({ error: 'origin_not_allowed' }, 403);
    }
    return next();
  });
  app.use('/v1/*', cors({
    origin: dependencies.webOrigin,
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    maxAge: 600,
  }));
  app.use('/v1/admin/*', async (context, next) => {
    const authorization = context.req.header('Authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!constantTimeMatches(token, dependencies.adminApiToken)) {
      return context.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });
  app.use('/v1/admin/*', bodyLimit({
    maxSize: 64 * 1024,
    onError: (context) => context.json({ error: 'request_too_large' }, 413),
  }));

  app.get('/v1/admin/ready', async (context) => {
    const readiness = await dependencies.readiness.check();
    return context.json(
      { status: readiness.ready ? 'ready' : 'not_ready' },
      readiness.ready ? 200 : 503,
    );
  });

  app.get('/v1/admin/projects', async (context) => {
    const includeArchived = context.req.query('includeArchived') === 'true';
    return context.json({ projects: await dependencies.projects.list(includeArchived) });
  });

  app.post('/v1/admin/projects', async (context) => {
    const input = await parseProjectDraft(context);
    if (!input.success) return input.response;
    const project = await dependencies.projects.create(input.data);
    return context.json({ project }, 201);
  });

  app.put('/v1/admin/projects/:projectId', async (context) => {
    const id = projectIdSchema.safeParse(context.req.param('projectId'));
    if (!id.success) return context.json({ error: 'invalid_project_id' }, 400);
    const input = await parseProjectDraft(context);
    if (!input.success) return input.response;
    const project = await dependencies.projects.update(id.data, input.data);
    return project
      ? context.json({ project })
      : context.json({ error: 'project_not_found' }, 404);
  });

  app.post('/v1/admin/projects/:projectId/archive', async (context) => {
    const id = projectIdSchema.safeParse(context.req.param('projectId'));
    if (!id.success) return context.json({ error: 'invalid_project_id' }, 400);
    const project = await dependencies.projects.archive(id.data);
    return project
      ? context.json({ project })
      : context.json({ error: 'project_not_found' }, 404);
  });

  app.onError((error, context) => {
    console.error('Unhandled API error', error);
    return context.json({ error: 'internal_server_error' }, 500);
  });

  app.notFound((context) => context.json({ error: 'not_found' }, 404));
  return app;
}

function constantTimeMatches(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}

async function parseProjectDraft(context: Context) {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return {
      success: false as const,
      response: context.json({ error: 'invalid_json' }, 400),
    };
  }
  const parsed = projectDraftSchema.safeParse(body);
  if (!parsed.success) {
    return {
      success: false as const,
      response: context.json({
        error: 'validation_error',
        issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      }, 400),
    };
  }
  return { success: true as const, data: parsed.data };
}
