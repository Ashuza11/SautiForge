import { describe, expect, it, vi } from 'vitest';

import type { ClipDraft } from '../clips/clip';
import { ClipLifecycleError, type ClipService } from '../clips/clip-service';
import type { SourceMediaService } from '../media/source-media-service';
import type { ProjectService } from '../projects/project-service';
import type { ReadinessService } from '../readiness';
import type { SourceService } from '../sources/source-service';
import { createServerApp } from './app';

const token = 'test-admin-token-that-is-long-enough';
const sourceId = '00000000-0000-4000-8000-000000000101';
const clipId = '00000000-0000-4000-8000-000000000401';
const sha = 'ab'.repeat(32);

const draft: ClipDraft = {
  clipKey: 'c001',
  startMs: 3082,
  endMs: 6102,
  trimmedMs: 0,
  durationMs: 3020,
  speakerRole: 'narrator',
  speakerName: 'Voice A',
  hasMusic: false,
  tier: 'asr_tts',
  segmenter: 'sautiseg 0.1.0',
  createdBy: 'ADMIN-01',
  audio: [
    { variant: 'original', sizeBytes: 144_000, sha256: sha, sampleRate: 24000, durationMs: 3020 },
    { variant: 'vocals_htdemucs', sizeBytes: 144_000, sha256: sha, sampleRate: 24000, durationMs: 3020 },
  ],
};

function clipApp() {
  const clips = {
    listForSource: vi.fn().mockResolvedValue([]),
    register: vi.fn().mockResolvedValue({ clip: { id: clipId }, files: [] }),
    complete: vi.fn().mockResolvedValue({ clip: { id: clipId, status: 'published' }, files: [] }),
    createAudioUrl: vi.fn().mockResolvedValue('https://storage.example/signed-get'),
    withdraw: vi.fn().mockResolvedValue({ clip: { id: clipId, status: 'withdrawn' }, files: [] }),
  } as unknown as ClipService;
  const app = createServerApp({
    projects: {} as ProjectService,
    sources: {} as SourceService,
    media: {} as SourceMediaService,
    clips,
    readiness: {} as ReadinessService,
    adminApiToken: token,
    webOrigin: 'https://annotation.example.org',
  });
  const call = (path: string, method = 'GET', body?: unknown) => app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { call, clips, app };
}

describe('clip routes', () => {
  it('requires admin authorization', async () => {
    const { app } = clipApp();
    expect((await app.request(`/v1/admin/sources/${sourceId}/clips`)).status).toBe(401);
  });

  it('lists clips, optionally by status, and rejects an unknown status', async () => {
    const { call, clips } = clipApp();
    expect((await call(`/v1/admin/sources/${sourceId}/clips?status=published`)).status).toBe(200);
    expect(clips.listForSource).toHaveBeenCalledWith(sourceId, 'published');
    expect((await call(`/v1/admin/sources/${sourceId}/clips?status=bogus`)).status).toBe(400);
    expect((await call('/v1/admin/sources/nope/clips')).status).toBe(400);
  });

  it('registers a valid clip and rejects invalid drafts before the service is called', async () => {
    const { call, clips } = clipApp();
    expect((await call(`/v1/admin/sources/${sourceId}/clips`, 'POST', draft)).status).toBe(200);
    expect(clips.register).toHaveBeenCalledTimes(1);

    const bad = [
      { ...draft, audio: [draft.audio[0]] },
      { ...draft, hasMusic: true },
      { ...draft, endMs: 10 },
      { ...draft, extra: 'field' },
      { ...draft, audio: [{ ...draft.audio[1], sha256: 'xyz' }] },
    ];
    for (const body of bad) {
      expect((await call(`/v1/admin/sources/${sourceId}/clips`, 'POST', body)).status).toBe(400);
    }
    expect(clips.register).toHaveBeenCalledTimes(1);
  });

  it('completes, signs playback and withdraws', async () => {
    const { call, clips } = clipApp();
    expect((await call(`/v1/admin/clips/${clipId}/complete`, 'POST')).status).toBe(200);
    const audio = await call(`/v1/admin/clips/${clipId}/audio/vocals_htdemucs`);
    expect(await audio.json()).toEqual({ url: 'https://storage.example/signed-get' });
    expect((await call(`/v1/admin/clips/${clipId}/audio/other`)).status).toBe(400);
    expect((await call(`/v1/admin/clips/${clipId}/withdraw`, 'POST')).status).toBe(200);
    expect(clips.withdraw).toHaveBeenCalledWith(clipId);
  });

  it('maps lifecycle errors to 404 and 409', async () => {
    const { call, clips } = clipApp();
    vi.mocked(clips.complete).mockRejectedValueOnce(new ClipLifecycleError('clip_not_found', 'missing'));
    expect((await call(`/v1/admin/clips/${clipId}/complete`, 'POST')).status).toBe(404);
    vi.mocked(clips.complete).mockRejectedValueOnce(new ClipLifecycleError('verification_failed', 'bad'));
    expect((await call(`/v1/admin/clips/${clipId}/complete`, 'POST')).status).toBe(409);
  });
});
