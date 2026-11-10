import { describe, expect, it, vi } from 'vitest';

import type { ClipService } from '../clips/clip-service';
import type { BatchService } from '../batches/batch-service';
import type { VolunteerService } from '../volunteer/volunteer-service';
import type { SourceMedia } from '../media/source-media';
import { SourceMediaLifecycleError, type SourceMediaService } from '../media/source-media-service';
import type { ProjectService } from '../projects/project-service';
import type { ReadinessService } from '../readiness';
import type { SourceService } from '../sources/source-service';
import type { ResultsService } from '../results/results-service';
import { createServerApp } from './app';

const token = 'media-admin-token-that-is-long-enough';
const sourceId = '00000000-0000-4000-8000-000000000101';
const mediaId = '00000000-0000-4000-8000-000000000301';

const mediaRecord = {
  id: mediaId,
  sourceId,
  status: 'upload_pending',
} as SourceMedia;

function mediaApp() {
  const sources = {
    getDetail: vi.fn().mockResolvedValue({ source: { id: sourceId }, latestRights: {} }),
  } as unknown as SourceService;
  const media = {
    listForSource: vi.fn().mockResolvedValue([mediaRecord]),
    initiateUpload: vi.fn().mockResolvedValue({
      media: mediaRecord,
      upload: {
        url: 'https://storage.example/signed',
        headers: {
          'content-type': 'audio/ogg',
          'x-amz-checksum-sha256': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          'x-amz-server-side-encryption': 'AES256',
        },
      },
    }),
    completeUpload: vi.fn().mockResolvedValue({ ...mediaRecord, status: 'verified' }),
  } as unknown as SourceMediaService;
  return {
    app: createServerApp({
      projects: {} as ProjectService,
      sources,
      media,
      clips: {} as ClipService,
      batches: {} as BatchService,
      volunteer: {} as VolunteerService,
      results: {} as ResultsService,
      readiness: {} as ReadinessService,
      adminApiToken: token,
      webOrigin: 'https://annotation.example.org',
    }),
    media,
    sources,
  };
}

function request(app: ReturnType<typeof mediaApp>['app'], path: string, method = 'GET', body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const draft = {
  fileName: 'master.opus',
  contentType: 'audio/ogg',
  sizeBytes: 4096,
  sha256: '00'.repeat(32),
  createdBy: 'ADMIN-01',
};

describe('source media administration API', () => {
  it('keeps master metadata and upload signing behind the administrator boundary', async () => {
    const { app } = mediaApp();
    expect((await app.request(`/v1/admin/sources/${sourceId}/media`)).status).toBe(401);
    expect((await app.request(`/v1/admin/sources/${sourceId}/media/uploads`, { method: 'POST' })).status).toBe(401);
  });

  it('lists media for an existing source and returns 404 for an absent source', async () => {
    const { app, media, sources } = mediaApp();
    const listed = await request(app, `/v1/admin/sources/${sourceId}/media`);
    expect(listed.status).toBe(200);
    expect((await listed.json()).media).toHaveLength(1);
    expect(media.listForSource).toHaveBeenCalledWith(sourceId);

    vi.mocked(sources.getDetail).mockResolvedValueOnce(null);
    const missing = await request(app, '/v1/admin/sources/00000000-0000-4000-8000-000000000999/media');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'source_not_found' });
  });

  it('validates and initiates a direct-to-private-storage upload', async () => {
    const { app, media } = mediaApp();
    const invalid = await request(app, `/v1/admin/sources/${sourceId}/media/uploads`, 'POST', {
      ...draft,
      contentType: 'application/zip',
    });
    expect(invalid.status).toBe(400);
    expect(media.initiateUpload).not.toHaveBeenCalled();

    const response = await request(app, `/v1/admin/sources/${sourceId}/media/uploads`, 'POST', draft);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      media: { id: mediaId, status: 'upload_pending' },
      upload: { headers: { 'x-amz-server-side-encryption': 'AES256' } },
    });
  });

  it('completes verification and exposes recoverable lifecycle errors', async () => {
    const { app, media } = mediaApp();
    const complete = await request(app, `/v1/admin/source-media/${mediaId}/complete`, 'POST');
    expect(complete.status).toBe(200);
    expect((await complete.json()).media.status).toBe('verified');

    vi.mocked(media.completeUpload).mockRejectedValue(new SourceMediaLifecycleError('object_unavailable', 'Retry later.'));
    const unavailable = await request(app, `/v1/admin/source-media/${mediaId}/complete`, 'POST');
    expect(unavailable.status).toBe(409);
    expect(await unavailable.json()).toEqual({ error: 'object_unavailable', message: 'Retry later.' });
  });
});
