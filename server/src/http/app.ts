import { timingSafeEqual } from 'node:crypto';

import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { z } from 'zod';

import { AdminSessionService, adminSessionCookieName } from '../auth/admin-session';
import { batchDraftSchema } from '../batches/batch';
import { BatchLifecycleError, type BatchService } from '../batches/batch-service';
import { clipDraftSchema, clipStatusSchema, clipVariantSchema } from '../clips/clip';
import { ClipLifecycleError, type ClipService } from '../clips/clip-service';
import { projectDraftSchema } from '../../../src/features/projects/domain/project';
import { finalDraftSchema } from '../finals/final';
import { FinalError, type FinalService } from '../finals/final-service';
import type { ResultsService } from '../results/results-service';
import { createRateLimiter, visitorKey } from './rate-limit';
import { infoSchema, joinSchema, sessionSchema, skipSchema, submitSchema } from '../volunteer/volunteer';
import { VolunteerError, type VolunteerService } from '../volunteer/volunteer-service';
import { sourceMediaUploadDraftSchema } from '../media/source-media';
import { SourceMediaLifecycleError, type SourceMediaService } from '../media/source-media-service';
import type { ProjectService } from '../projects/project-service';
import type { ReadinessService } from '../readiness';
import {
  sourceMetadataDraftSchema,
  sourceRightsDraftSchema,
} from '../sources/source';
import { SourceLifecycleError, type SourceService } from '../sources/source-service';

export type AppDependencies = {
  projects: ProjectService;
  sources: SourceService;
  media: SourceMediaService;
  clips: ClipService;
  batches: BatchService;
  volunteer: VolunteerService;
  results: ResultsService;
  finals: FinalService;
  readiness: ReadinessService;
  adminApiToken: string;
  webOrigin: string;
  adminSession?: AdminSessionService;
  secureCookies?: boolean;
  /** Overridable for tests; defaults to 240 volunteer requests per visitor per minute. */
  volunteerRateLimit?: { allow(key: string): boolean };
};

const projectIdSchema = z.string().uuid();
const sourceIdSchema = z.string().uuid();
const sourceMediaIdSchema = z.string().uuid();
const clipIdSchema = z.string().uuid();

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
    credentials: true,
    maxAge: 600,
  }));
  app.post('/v1/auth/login', bodyLimit({
    maxSize: 4 * 1024,
    onError: (context) => context.json({ error: 'request_too_large' }, 413),
  }), async (context) => {
    const session = dependencies.adminSession;
    if (!session) return context.json({ error: 'login_not_configured' }, 503);
    if (context.req.header('Origin') !== dependencies.webOrigin) {
      return context.json({ error: 'origin_not_allowed' }, 403);
    }
    const input = await parseValidatedBody(context, z.object({ password: z.string().min(1).max(256) }).strict());
    if (!input.success) return input.response;
    const result = session.login(input.data.password);
    if (result === null) return context.json({ error: 'invalid_credentials' }, 401);
    if ('locked' in result) return context.json({ error: 'too_many_attempts' }, 429);
    setCookie(context, adminSessionCookieName, result.token, {
      httpOnly: true,
      secure: dependencies.secureCookies ?? true,
      sameSite: 'Lax',
      path: '/',
      maxAge: session.maxAgeSeconds,
    });
    return context.json({ status: 'signed_in' });
  });

  app.post('/v1/auth/logout', (context) => {
    if (context.req.header('Origin') !== dependencies.webOrigin) {
      return context.json({ error: 'origin_not_allowed' }, 403);
    }
    deleteCookie(context, adminSessionCookieName, { path: '/' });
    return context.json({ status: 'signed_out' });
  });

  app.use('/v1/admin/*', async (context, next) => {
    const authorization = context.req.header('Authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (constantTimeMatches(token, dependencies.adminApiToken)) {
      await next();
      return;
    }
    const session = dependencies.adminSession;
    if (session?.verify(getCookie(context, adminSessionCookieName))) {
      // Cookies are sent automatically by browsers, so state changes must
      // come from the configured web origin.
      const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(context.req.method);
      if (!safeMethod && context.req.header('Origin') !== dependencies.webOrigin) {
        return context.json({ error: 'origin_not_allowed' }, 403);
      }
      await next();
      return;
    }
    return context.json({ error: 'unauthorized' }, 401);
  });
  // Volunteer routes: public, no admin session. Each call carries a batch link and a personal token.
  // One visitor can make plenty of requests while listening and writing, but not thousands.
  const visitorLimiter = dependencies.volunteerRateLimit ?? createRateLimiter({ limit: 240, windowMs: 60_000 });
  app.use('/v1/volunteer/*', async (context, next) => {
    if (!visitorLimiter.allow(visitorKey(context.req.header('x-forwarded-for')))) {
      context.header('Retry-After', '60');
      return context.json({ error: 'rate_limited' }, 429);
    }
    await next();
  });
  const volunteerLimit = bodyLimit({ maxSize: 8 * 1024, onError: (context) => context.json({ error: 'request_too_large' }, 413) });
  app.post('/v1/volunteer/info', volunteerLimit, async (context) => {
    const input = await parseValidatedBody(context, infoSchema);
    if (!input.success) return input.response;
    return context.json(await dependencies.volunteer.info(input.data.link));
  });
  app.post('/v1/volunteer/join', volunteerLimit, async (context) => {
    const input = await parseValidatedBody(context, joinSchema);
    if (!input.success) return input.response;
    return context.json(await dependencies.volunteer.join(input.data.link, input.data.pseudonym), 201);
  });
  app.post('/v1/volunteer/next', volunteerLimit, async (context) => {
    const input = await parseValidatedBody(context, sessionSchema);
    if (!input.success) return input.response;
    return context.json(await dependencies.volunteer.next(input.data.link, input.data.contributor));
  });
  app.post('/v1/volunteer/submit', volunteerLimit, async (context) => {
    const input = await parseValidatedBody(context, submitSchema);
    if (!input.success) return input.response;
    return context.json({ status: await dependencies.volunteer.submit(input.data.link, input.data.contributor, input.data.clipId, input.data.text) });
  });
  app.post('/v1/volunteer/skip', volunteerLimit, async (context) => {
    const input = await parseValidatedBody(context, skipSchema);
    if (!input.success) return input.response;
    return context.json({ status: await dependencies.volunteer.skip(input.data.link, input.data.contributor, input.data.clipId) });
  });

  const smallBodyLimit = bodyLimit({
    maxSize: 64 * 1024,
    onError: (context) => context.json({ error: 'request_too_large' }, 413),
  });
  // JSON requests are small. Only the FLAC upload route may be larger, and it sets its own 4 MB limit.
  app.use('/v1/admin/*', (context, next) => (
    context.req.method === 'POST' && /^\/v1\/admin\/sources\/[^/]+\/clips\/upload$/.test(context.req.path)
      ? next()
      : smallBodyLimit(context, next)
  ));

  app.get('/v1/admin/session', (context) => context.json({ status: 'signed_in' }));

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
    const input = await parseValidatedBody(context, projectDraftSchema);
    if (!input.success) return input.response;
    const project = await dependencies.projects.create(input.data);
    return context.json({ project }, 201);
  });

  app.put('/v1/admin/projects/:projectId', async (context) => {
    const id = projectIdSchema.safeParse(context.req.param('projectId'));
    if (!id.success) return context.json({ error: 'invalid_project_id' }, 400);
    const input = await parseValidatedBody(context, projectDraftSchema);
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

  app.get('/v1/admin/projects/:projectId/sources', async (context) => {
    const projectId = projectIdSchema.safeParse(context.req.param('projectId'));
    if (!projectId.success) return context.json({ error: 'invalid_project_id' }, 400);
    const includeInactive = context.req.query('includeInactive') === 'true';
    return context.json({ sources: await dependencies.sources.list(projectId.data, includeInactive) });
  });

  app.post('/v1/admin/projects/:projectId/sources', async (context) => {
    const projectId = projectIdSchema.safeParse(context.req.param('projectId'));
    if (!projectId.success) return context.json({ error: 'invalid_project_id' }, 400);
    const input = await parseValidatedBody(context, sourceMetadataDraftSchema);
    if (!input.success) return input.response;
    const source = await dependencies.sources.create(projectId.data, input.data);
    return context.json({ source }, 201);
  });

  app.get('/v1/admin/sources/:sourceId', async (context) => {
    const id = sourceIdSchema.safeParse(context.req.param('sourceId'));
    if (!id.success) return context.json({ error: 'invalid_source_id' }, 400);
    const detail = await dependencies.sources.getDetail(id.data);
    return detail
      ? context.json(detail)
      : context.json({ error: 'source_not_found' }, 404);
  });

  app.put('/v1/admin/sources/:sourceId', async (context) => {
    const id = sourceIdSchema.safeParse(context.req.param('sourceId'));
    if (!id.success) return context.json({ error: 'invalid_source_id' }, 400);
    const input = await parseValidatedBody(context, sourceMetadataDraftSchema);
    if (!input.success) return input.response;
    const source = await dependencies.sources.updateMetadata(id.data, input.data);
    return source
      ? context.json({ source })
      : context.json({ error: 'source_not_found' }, 404);
  });

  app.get('/v1/admin/sources/:sourceId/rights', async (context) => {
    const id = sourceIdSchema.safeParse(context.req.param('sourceId'));
    if (!id.success) return context.json({ error: 'invalid_source_id' }, 400);
    const detail = await dependencies.sources.getDetail(id.data);
    if (!detail) return context.json({ error: 'source_not_found' }, 404);
    return context.json({ revisions: await dependencies.sources.rightsHistory(id.data) });
  });

  app.post('/v1/admin/sources/:sourceId/rights', async (context) => {
    const id = sourceIdSchema.safeParse(context.req.param('sourceId'));
    if (!id.success) return context.json({ error: 'invalid_source_id' }, 400);
    const input = await parseValidatedBody(context, sourceRightsDraftSchema);
    if (!input.success) return input.response;
    const result = await dependencies.sources.addRightsRevision(id.data, input.data);
    return result
      ? context.json(result, 201)
      : context.json({ error: 'source_not_found' }, 404);
  });

  app.get('/v1/admin/sources/:sourceId/media', async (context) => {
    const id = sourceIdSchema.safeParse(context.req.param('sourceId'));
    if (!id.success) return context.json({ error: 'invalid_source_id' }, 400);
    const detail = await dependencies.sources.getDetail(id.data);
    if (!detail) return context.json({ error: 'source_not_found' }, 404);
    return context.json({ media: await dependencies.media.listForSource(id.data) });
  });

  app.post('/v1/admin/sources/:sourceId/media/uploads', async (context) => {
    const id = sourceIdSchema.safeParse(context.req.param('sourceId'));
    if (!id.success) return context.json({ error: 'invalid_source_id' }, 400);
    const input = await parseValidatedBody(context, sourceMediaUploadDraftSchema);
    if (!input.success) return input.response;
    const result = await dependencies.media.initiateUpload(id.data, input.data);
    return context.json(result, 201);
  });

  app.post('/v1/admin/source-media/:mediaId/complete', async (context) => {
    const id = sourceMediaIdSchema.safeParse(context.req.param('mediaId'));
    if (!id.success) return context.json({ error: 'invalid_media_id' }, 400);
    return context.json({ media: await dependencies.media.completeUpload(id.data) });
  });

  app.get('/v1/admin/sources/:sourceId/clips', async (context) => {
    const id = sourceIdSchema.safeParse(context.req.param('sourceId'));
    if (!id.success) return context.json({ error: 'invalid_source_id' }, 400);
    const statusQuery = context.req.query('status');
    const status = statusQuery === undefined ? { success: true as const, data: undefined } : clipStatusSchema.safeParse(statusQuery);
    if (!status.success) return context.json({ error: 'invalid_status' }, 400);
    return context.json({ clips: await dependencies.clips.listForSource(id.data, status.data) });
  });

  app.post('/v1/admin/sources/:sourceId/clips', async (context) => {
    const id = sourceIdSchema.safeParse(context.req.param('sourceId'));
    if (!id.success) return context.json({ error: 'invalid_source_id' }, 400);
    const input = await parseValidatedBody(context, clipDraftSchema);
    if (!input.success) return input.response;
    return context.json(await dependencies.clips.register(id.data, input.data));
  });

  app.post('/v1/admin/sources/:sourceId/clips/upload', bodyLimit({
    maxSize: 4 * 1024 * 1024,
    onError: (context) => context.json({ error: 'file_too_large', message: 'Each file must be smaller than 4 MB.' }, 413),
  }), async (context) => {
    const id = sourceIdSchema.safeParse(context.req.param('sourceId'));
    if (!id.success) return context.json({ error: 'invalid_source_id' }, 400);
    const clipKey = clipDraftSchema.shape.clipKey.safeParse(context.req.query('clipKey'));
    if (!clipKey.success) return context.json({ error: 'invalid_clip_key', message: 'Use a file name of letters, digits, dash or underscore.' }, 400);
    const createdBy = clipDraftSchema.shape.createdBy.safeParse(context.req.query('createdBy') ?? 'ADMIN-01');
    if (!createdBy.success) return context.json({ error: 'invalid_created_by' }, 400);
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    return context.json(await dependencies.clips.uploadFlac(id.data, { clipKey: clipKey.data, bytes, createdBy: createdBy.data }));
  });

  app.get('/v1/admin/sources/:sourceId/batches', async (context) => {
    const id = sourceIdSchema.safeParse(context.req.param('sourceId'));
    if (!id.success) return context.json({ error: 'invalid_source_id' }, 400);
    return context.json({ batches: await dependencies.batches.listForSource(id.data) });
  });

  app.get('/v1/admin/sources/:sourceId/results', async (context) => {
    const id = sourceIdSchema.safeParse(context.req.param('sourceId'));
    if (!id.success) return context.json({ error: 'invalid_source_id' }, 400);
    return context.json(await dependencies.results.forSource(id.data));
  });

  app.get('/v1/admin/sources/:sourceId/export', async (context) => {
    const id = sourceIdSchema.safeParse(context.req.param('sourceId'));
    if (!id.success) return context.json({ error: 'invalid_source_id' }, 400);
    return context.json(await dependencies.finals.manifest(id.data));
  });

  app.get('/v1/admin/clips/:clipId/final', async (context) => {
    const id = clipIdSchema.safeParse(context.req.param('clipId'));
    if (!id.success) return context.json({ error: 'invalid_clip_id' }, 400);
    return context.json({ history: await dependencies.finals.history(id.data) });
  });

  app.post('/v1/admin/clips/:clipId/final', async (context) => {
    const id = clipIdSchema.safeParse(context.req.param('clipId'));
    if (!id.success) return context.json({ error: 'invalid_clip_id' }, 400);
    const input = await parseValidatedBody(context, finalDraftSchema);
    if (!input.success) return input.response;
    return context.json({ final: await dependencies.finals.record(id.data, input.data, 'ADMIN-01') }, 201);
  });

  app.post('/v1/admin/sources/:sourceId/batches', async (context) => {
    const id = sourceIdSchema.safeParse(context.req.param('sourceId'));
    if (!id.success) return context.json({ error: 'invalid_source_id' }, 400);
    const input = await parseValidatedBody(context, batchDraftSchema);
    if (!input.success) return input.response;
    return context.json(await dependencies.batches.create(id.data, input.data, 'ADMIN-01'), 201);
  });

  app.post('/v1/admin/batches/:batchId/close', async (context) => {
    const id = z.string().uuid().safeParse(context.req.param('batchId'));
    if (!id.success) return context.json({ error: 'invalid_batch_id' }, 400);
    return context.json(await dependencies.batches.close(id.data));
  });

  app.post('/v1/admin/clips/:clipId/complete', async (context) => {
    const id = clipIdSchema.safeParse(context.req.param('clipId'));
    if (!id.success) return context.json({ error: 'invalid_clip_id' }, 400);
    return context.json(await dependencies.clips.complete(id.data));
  });

  app.get('/v1/admin/clips/:clipId/audio/:variant', async (context) => {
    const id = clipIdSchema.safeParse(context.req.param('clipId'));
    if (!id.success) return context.json({ error: 'invalid_clip_id' }, 400);
    const variant = clipVariantSchema.safeParse(context.req.param('variant'));
    if (!variant.success) return context.json({ error: 'invalid_variant' }, 400);
    return context.json({ url: await dependencies.clips.createAudioUrl(id.data, variant.data) });
  });

  app.post('/v1/admin/clips/:clipId/withdraw', async (context) => {
    const id = clipIdSchema.safeParse(context.req.param('clipId'));
    if (!id.success) return context.json({ error: 'invalid_clip_id' }, 400);
    return context.json(await dependencies.clips.withdraw(id.data));
  });

  app.onError((error, context) => {
    if (error instanceof SourceLifecycleError) {
      return context.json({ error: error.code, message: error.message }, 409);
    }
    if (error instanceof SourceMediaLifecycleError) {
      const status = ['source_not_found', 'media_not_found'].includes(error.code) ? 404 : 409;
      return context.json({ error: error.code, message: error.message }, status);
    }
    if (error instanceof FinalError) {
      return context.json({ error: error.code, message: error.message }, error.code === 'clip_not_eligible' ? 409 : 404);
    }
    if (error instanceof VolunteerError) {
      const status = error.code === 'link_invalid' ? 404 : error.code === 'contributor_invalid' ? 401 : error.code === 'too_many_joins' ? 429 : 409;
      return context.json({ error: error.code, message: error.message }, status);
    }
    if (error instanceof BatchLifecycleError) {
      const status = ['source_not_found', 'batch_not_found'].includes(error.code) ? 404 : 409;
      return context.json({ error: error.code, message: error.message }, status);
    }
    if (error instanceof ClipLifecycleError) {
      const status = ['source_not_found', 'clip_not_found', 'audio_not_found'].includes(error.code) ? 404
        : error.code === 'unsupported_audio' ? 422 : 409;
      return context.json({ error: error.code, message: error.message }, status);
    }
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

async function parseValidatedBody<Output>(context: Context, schema: z.ZodType<Output>) {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return {
      success: false as const,
      response: context.json({ error: 'invalid_json' }, 400),
    };
  }
  const parsed = schema.safeParse(body);
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
