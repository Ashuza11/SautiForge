import { describe, expect, it, vi } from 'vitest';

import { BatchLifecycleError, type BatchService } from '../batches/batch-service';
import type { VolunteerService } from '../volunteer/volunteer-service';
import type { ClipService } from '../clips/clip-service';
import type { SourceMediaService } from '../media/source-media-service';
import type { ProjectService } from '../projects/project-service';
import type { ReadinessService } from '../readiness';
import type { SourceService } from '../sources/source-service';
import type { ResultsService } from '../results/results-service';
import { createServerApp } from './app';

const token = 'test-admin-token-that-is-long-enough';
const sourceId = '00000000-0000-4000-8000-000000000101';
const batchId = '00000000-0000-4000-8000-000000000901';
const clipId = '00000000-0000-4000-8000-000000000401';

function batchApp() {
  const batches = {
    listForSource: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ batch: { id: batchId }, clipIds: [clipId], token: 'abc' }),
    close: vi.fn().mockResolvedValue({ batch: { id: batchId, status: 'closed' }, clipIds: [], token: 'abc' }),
  } as unknown as BatchService;
  const app = createServerApp({
    projects: {} as ProjectService,
    sources: {} as SourceService,
    media: {} as SourceMediaService,
    clips: {} as ClipService,
    batches,
    volunteer: {} as VolunteerService,
    results: {} as ResultsService,
    readiness: {} as ReadinessService,
    adminApiToken: token,
    webOrigin: 'https://annotation.example.org',
  });
  const call = (path: string, method = 'GET', body?: unknown) => app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { app, call, batches };
}

describe('batch routes', () => {
  it('requires admin authorization', async () => {
    const { app } = batchApp();
    expect((await app.request(`/v1/admin/sources/${sourceId}/batches`)).status).toBe(401);
    expect((await app.request(`/v1/admin/batches/${batchId}/close`, { method: 'POST' })).status).toBe(401);
    expect((await app.request(`/v1/admin/sources/${sourceId}/results`)).status).toBe(401);
  });

  it('lists and creates batches, validating the body before the service is called', async () => {
    const { call, batches } = batchApp();
    expect((await call(`/v1/admin/sources/${sourceId}/batches`)).status).toBe(200);
    const created = await call(`/v1/admin/sources/${sourceId}/batches`, 'POST', { clipIds: [clipId] });
    expect(created.status).toBe(201);
    expect(batches.create).toHaveBeenCalledWith(sourceId, { title: null, clipIds: [clipId] }, 'ADMIN-01');
    for (const body of [{ clipIds: [] }, { clipIds: ['nope'] }, { clipIds: [clipId, clipId] }, { clipIds: [clipId], extra: 1 }, {}]) {
      expect((await call(`/v1/admin/sources/${sourceId}/batches`, 'POST', body)).status).toBe(400);
    }
    expect((await call('/v1/admin/sources/bad/batches')).status).toBe(400);
    expect(batches.create).toHaveBeenCalledTimes(1);
  });

  it('closes a batch and maps lifecycle errors', async () => {
    const { call, batches } = batchApp();
    expect((await call(`/v1/admin/batches/${batchId}/close`, 'POST')).status).toBe(200);
    expect((await call('/v1/admin/batches/not-a-uuid/close', 'POST')).status).toBe(400);
    vi.mocked(batches.close).mockRejectedValueOnce(new BatchLifecycleError('batch_not_found', 'missing'));
    expect((await call(`/v1/admin/batches/${batchId}/close`, 'POST')).status).toBe(404);
    vi.mocked(batches.create).mockRejectedValueOnce(new BatchLifecycleError('clips_unavailable', 'taken'));
    expect((await call(`/v1/admin/sources/${sourceId}/batches`, 'POST', { clipIds: [clipId] })).status).toBe(409);
  });
});
