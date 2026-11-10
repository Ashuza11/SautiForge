import { describe, expect, it, vi } from 'vitest';

import type { BatchService } from '../batches/batch-service';
import type { VolunteerService } from '../volunteer/volunteer-service';
import type { ClipDraft } from '../clips/clip';
import { ClipLifecycleError, type ClipService } from '../clips/clip-service';
import type { SourceMediaService } from '../media/source-media-service';
import type { ProjectService } from '../projects/project-service';
import type { ReadinessService } from '../readiness';
import type { SourceService } from '../sources/source-service';
import type { FinalService } from '../finals/final-service';
import type { ResultsService } from '../results/results-service';
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
    { variant: 'master', derivedFrom: 'cleaned', sizeBytes: 90_000, sha256: sha, pcmSha256: sha, sampleRate: 24000, durationMs: 3020 },
    { variant: 'listening', derivedFrom: 'cleaned', sizeBytes: 9_000, sha256: sha, pcmSha256: null, sampleRate: 48000, durationMs: 3020 },
  ],
};

function clipApp() {
  const clips = {
    listForSource: vi.fn().mockResolvedValue([]),
    register: vi.fn().mockResolvedValue({ clip: { id: clipId }, files: [] }),
    uploadFlac: vi.fn().mockResolvedValue({ clip: { id: clipId, status: 'published' }, files: [] }),
    complete: vi.fn().mockResolvedValue({ clip: { id: clipId, status: 'published' }, files: [] }),
    createAudioUrl: vi.fn().mockResolvedValue('https://storage.example/signed-get'),
    withdraw: vi.fn().mockResolvedValue({ clip: { id: clipId, status: 'withdrawn' }, files: [] }),
  } as unknown as ClipService;
  const app = createServerApp({
    projects: {} as ProjectService,
    sources: {} as SourceService,
    media: {} as SourceMediaService,
    clips,
    batches: {} as BatchService,
    volunteer: {} as VolunteerService,
    results: {} as ResultsService,
    finals: {} as FinalService,
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
      { ...draft, audio: [draft.audio[1]] },
      { ...draft, audio: [] },
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
    const audio = await call(`/v1/admin/clips/${clipId}/audio/listening`);
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

  it('accepts a raw FLAC upload with the clip key from the file name', async () => {
    const { app, clips } = clipApp();
    const send = (query: string, body: Uint8Array) => app.request(`/v1/admin/sources/${sourceId}/clips/upload${query}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/flac' },
      body: body as BodyInit,
    });
    expect((await send('?clipKey=c001', new Uint8Array([1, 2, 3]))).status).toBe(200);
    expect((await send('?clipKey=c004', new Uint8Array(200 * 1024))).status).toBe(200); // far above the 64 KB JSON limit
    expect(clips.uploadFlac).toHaveBeenCalledWith(sourceId, { clipKey: 'c001', bytes: new Uint8Array([1, 2, 3]), createdBy: 'ADMIN-01' });
    expect((await send('?clipKey=bad%20name!', new Uint8Array([1]))).status).toBe(400);
    expect((await send('', new Uint8Array([1]))).status).toBe(400);
    expect((await send('?clipKey=c002&createdBy=x', new Uint8Array([1]))).status).toBe(400);
    expect(clips.uploadFlac).toHaveBeenCalledTimes(2);
    const tooBig = await send('?clipKey=c003', new Uint8Array(4 * 1024 * 1024 + 1));
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toMatchObject({ error: 'file_too_large' });
    // other admin requests keep the small limit
    const bigJson = await app.request('/v1/admin/projects', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(70 * 1024) }),
    });
    expect(bigJson.status).toBe(413);
    expect(await bigJson.json()).toMatchObject({ error: 'request_too_large' });
  });

  it('answers 422 when the file is not usable audio', async () => {
    const { app, clips } = clipApp();
    vi.mocked(clips.uploadFlac).mockRejectedValueOnce(new ClipLifecycleError('unsupported_audio', 'This is not a FLAC file.'));
    const response = await app.request(`/v1/admin/sources/${sourceId}/clips/upload?clipKey=c001`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: new Uint8Array([1]),
    });
    expect(response.status).toBe(422);
  });
});
