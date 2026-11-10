import { describe, expect, it, vi } from 'vitest';

import type { BatchService } from '../batches/batch-service';
import type { ClipService } from '../clips/clip-service';
import { FinalError, type FinalService } from '../finals/final-service';
import type { SourceMediaService } from '../media/source-media-service';
import type { ProjectService } from '../projects/project-service';
import type { ReadinessService } from '../readiness';
import type { ResultsService } from '../results/results-service';
import type { SourceService } from '../sources/source-service';
import type { VolunteerService } from '../volunteer/volunteer-service';
import { createServerApp } from './app';

const token = 'test-admin-token-that-is-long-enough';
const clipId = '00000000-0000-4000-8000-000000000401';
const sourceId = '00000000-0000-4000-8000-000000000101';

function finalApp() {
  const finals = {
    record: vi.fn().mockResolvedValue({ id: 'x', version: 1 }),
    history: vi.fn().mockResolvedValue([]),
    manifest: vi.fn().mockResolvedValue({ clips: [] }),
  } as unknown as FinalService;
  const app = createServerApp({
    projects: {} as ProjectService, sources: {} as SourceService, media: {} as SourceMediaService, clips: {} as ClipService,
    batches: {} as BatchService, volunteer: {} as VolunteerService, results: {} as ResultsService, finals,
    readiness: {} as ReadinessService, adminApiToken: token, webOrigin: 'https://annotation.example.org',
  });
  const call = (path: string, method = 'GET', body?: unknown) => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { app, call, finals };
}

describe('final transcript routes', () => {
  it('are admin only', async () => {
    const { app } = finalApp();
    expect((await app.request(`/v1/admin/clips/${clipId}/final`)).status).toBe(401);
    expect((await app.request(`/v1/admin/sources/${sourceId}/export`)).status).toBe(401);
  });

  it('records a decision, cleaning the text, and rejects invalid bodies before the service', async () => {
    const { call, finals } = finalApp();
    expect((await call(`/v1/admin/clips/${clipId}/final`, 'POST', { decision: 'approved', text: ' mwana \n wa ', note: 'checked' })).status).toBe(201);
    expect(finals.record).toHaveBeenCalledWith(clipId, { decision: 'approved', text: 'mwana wa', chosenSubmissionId: null, note: 'checked' }, 'ADMIN-01');
    for (const body of [{ decision: 'approved' }, { decision: 'approved', text: '  ' }, { decision: 'excluded', text: 'x' }, { decision: 'maybe' }, { decision: 'approved', text: 'a', extra: 1 }, { decision: 'approved', text: 'a', chosenSubmissionId: 'nope' }]) {
      expect((await call(`/v1/admin/clips/${clipId}/final`, 'POST', body)).status).toBe(400);
    }
    expect(finals.record).toHaveBeenCalledTimes(1);
    expect((await call('/v1/admin/clips/bad/final', 'POST', { decision: 'excluded' })).status).toBe(400);
  });

  it('serves history and the export list, and maps errors', async () => {
    const { call, finals } = finalApp();
    expect((await call(`/v1/admin/clips/${clipId}/final`)).status).toBe(200);
    expect((await call(`/v1/admin/sources/${sourceId}/export`)).status).toBe(200);
    expect((await call('/v1/admin/sources/bad/export')).status).toBe(400);
    vi.mocked(finals.manifest).mockRejectedValueOnce(new FinalError('source_not_found', 'missing'));
    expect((await call(`/v1/admin/sources/${sourceId}/export`)).status).toBe(404);
    vi.mocked(finals.record).mockRejectedValueOnce(new FinalError('clip_not_eligible', 'not in a batch'));
    expect((await call(`/v1/admin/clips/${clipId}/final`, 'POST', { decision: 'excluded' })).status).toBe(409);
  });
});
