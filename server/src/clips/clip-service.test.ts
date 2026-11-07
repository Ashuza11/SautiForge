import { describe, expect, it, vi } from 'vitest';

import type { Source } from '../sources/source';
import { SourceLifecycleError, type SourceService } from '../sources/source-service';
import type { PrivateObjectStore } from '../storage/private-object-store';
import type { Clip, ClipAudioFile, ClipDraft, ClipStatus, ClipWithFiles } from './clip';
import type { ClipRepository } from './clip-repository';
import { ClipService } from './clip-service';

const projectId = '00000000-0000-4000-8000-000000000001';
const sourceId = '00000000-0000-4000-8000-000000000101';
const sha = 'ab'.repeat(32);
const checksum = Buffer.from(sha, 'hex').toString('base64');

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
  segmenter: null,
  createdBy: 'ADMIN-01',
  audio: [
    { variant: 'original', sizeBytes: 144_000, sha256: sha, sampleRate: 24000, durationMs: 3020 },
    { variant: 'vocals_htdemucs', sizeBytes: 100_000, sha256: 'cd'.repeat(32), sampleRate: 24000, durationMs: 2500 },
  ],
};

class MemoryClips implements ClipRepository {
  clips = new Map<string, Clip>();
  files = new Map<string, ClipAudioFile>();
  allowWrites = true;
  allowPublish = true;
  private view(clip: Clip): ClipWithFiles {
    return { clip, files: [...this.files.values()].filter((file) => file.clipId === clip.id) };
  }
  async listForSource(id: string, status?: ClipStatus) {
    return [...this.clips.values()].filter((c) => c.sourceId === id && (!status || c.status === status)).map((c) => this.view(c));
  }
  async getById(id: string) { const c = this.clips.get(id); return c ? this.view(c) : null; }
  async findByKey(id: string, key: string) {
    const c = [...this.clips.values()].find((x) => x.sourceId === id && x.clipKey === key);
    return c ? this.view(c) : null;
  }
  async createWhenAuthorized(clip: Clip, files: ClipAudioFile[]) {
    if (!this.allowWrites) return null;
    this.clips.set(clip.id, clip);
    files.forEach((file) => this.files.set(file.id, file));
    return this.view(clip);
  }
  async updateMetadata(id: string, update: Parameters<ClipRepository['updateMetadata']>[1], updatedAt: string) {
    const c = this.clips.get(id);
    if (!c || !this.allowWrites) return false;
    this.clips.set(id, { ...c, ...update, updatedAt });
    return true;
  }
  async insertFile(file: ClipAudioFile) { if (!this.allowWrites) return false; this.files.set(file.id, file); return true; }
  async resetFile(file: ClipAudioFile) {
    const current = this.files.get(file.id);
    if (!current || current.status === 'verified' || !this.allowWrites) return false;
    this.files.set(file.id, file);
    return true;
  }
  async updateFileVerification(input: Parameters<ClipRepository['updateFileVerification']>[0]) {
    const f = this.files.get(input.id);
    if (!f || f.status !== 'upload_pending' || !this.allowWrites) return false;
    this.files.set(f.id, { ...f, status: input.status, verificationError: input.verificationError, verifiedAt: input.verifiedAt, updatedAt: input.updatedAt });
    return true;
  }
  async publish(id: string, now: string) {
    const c = this.clips.get(id);
    if (!c || c.status !== 'draft' || !this.allowPublish) return false;
    this.clips.set(id, { ...c, status: 'published', publishedAt: now, updatedAt: now });
    return true;
  }
  async withdraw(id: string, now: string) {
    const c = this.clips.get(id);
    if (!c) return false;
    this.clips.set(id, { ...c, status: 'withdrawn', withdrawnAt: now, updatedAt: now });
    return true;
  }
}

function setup() {
  let counter = 0;
  const repo = new MemoryClips();
  const sources = {
    getDetail: vi.fn().mockResolvedValue({ source: { id: sourceId, projectId } as Source, latestRights: { revision: 2 } }),
    assertUseAuthorized: vi.fn().mockResolvedValue(undefined),
  } as unknown as SourceService;
  const store = {
    createUploadUrl: vi.fn().mockImplementation(async (r: { key: string }) => ({ url: `https://storage.example/${r.key}`, headers: {} })),
    createDownloadUrl: vi.fn().mockResolvedValue('https://storage.example/get'),
    inspectObject: vi.fn(),
  } as unknown as PrivateObjectStore;
  const service = new ClipService(repo, sources, store, {
    idFactory: () => `00000000-0000-4000-8000-${String(++counter + 500).padStart(12, '0')}`,
    now: () => new Date('2026-11-07T10:00:00.000Z'),
  });
  const observe = (file: ClipAudioFile, overrides = {}) => ({
    contentLengthBytes: file.sizeBytes,
    contentType: 'audio/wav',
    checksumSha256: Buffer.from(file.sha256, 'hex').toString('base64'),
    serverSideEncryption: 'AES256',
    ...overrides,
  });
  const verifyAll = () => vi.mocked(store.inspectObject).mockImplementation(async (key: string) => {
    const file = [...repo.files.values()].find((f) => f.objectKey === key)!;
    return observe(file);
  });
  return { service, repo, sources, store, verifyAll };
}

describe('ClipService', () => {
  it('creates a rights-bound draft with signed uploads for both variants', async () => {
    const { service, repo, sources, store } = setup();
    const result = await service.register(sourceId, draft);
    expect(sources.assertUseAuthorized).toHaveBeenCalledWith(sourceId, 'internalProcessing');
    expect(result.clip).toMatchObject({ status: 'draft', rightsRevision: 2, clipKey: 'c001', projectId, sourceId });
    expect(result.files).toHaveLength(2);
    expect(result.files[0].upload?.url).toContain(`/clips/${result.clip.id}/original.wav`);
    expect(store.createUploadUrl).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'audio/wav',
      checksumSha256: checksum,
      contentLengthBytes: 144_000,
    }));
    expect(repo.files.size).toBe(2);
  });

  it('signs nothing for a missing source or an unauthorized use', async () => {
    const a = setup();
    vi.mocked(a.sources.getDetail).mockResolvedValue(null);
    await expect(a.service.register(sourceId, draft)).rejects.toMatchObject({ code: 'source_not_found' });
    const b = setup();
    vi.mocked(b.sources.assertUseAuthorized).mockRejectedValue(new SourceLifecycleError('use_not_authorized', 'no'));
    await expect(b.service.register(sourceId, draft)).rejects.toMatchObject({ code: 'use_not_authorized' });
    expect(b.store.createUploadUrl).not.toHaveBeenCalled();
  });

  it('fails closed when rights change before the guarded insert', async () => {
    const { service, repo } = setup();
    repo.allowWrites = false;
    await expect(service.register(sourceId, draft)).rejects.toMatchObject({ code: 'source_changed' });
    expect(repo.clips.size).toBe(0);
  });

  it('verifies uploads and publishes only after the cleaned audio checks out', async () => {
    const { service, repo, verifyAll, sources } = setup();
    const { clip } = await service.register(sourceId, draft);
    verifyAll();
    const done = await service.complete(clip.id);
    expect(done.clip.status).toBe('published');
    expect(done.files.every((f) => f.status === 'verified')).toBe(true);
    expect(sources.assertUseAuthorized).toHaveBeenCalledWith(sourceId, 'volunteerAccess');
    expect(sources.assertUseAuthorized).toHaveBeenCalledWith(sourceId, 'transcription');
    expect((await service.complete(clip.id)).clip.status).toBe('published');
    expect(repo.clips.get(clip.id)?.publishedAt).toBe('2026-11-07T10:00:00.000Z');
  });

  it.each([
    ['size_mismatch', { contentLengthBytes: 1 }],
    ['content_type_mismatch', { contentType: 'audio/mpeg' }],
    ['checksum_mismatch', { checksumSha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }],
    ['encryption_missing', { serverSideEncryption: null }],
  ])('keeps the clip a draft on %s', async (reason, override) => {
    const { service, repo, store } = setup();
    const { clip } = await service.register(sourceId, draft);
    vi.mocked(store.inspectObject).mockImplementation(async (key: string) => {
      const file = [...repo.files.values()].find((f) => f.objectKey === key)!;
      return { contentLengthBytes: file.sizeBytes, contentType: 'audio/wav', checksumSha256: Buffer.from(file.sha256, 'hex').toString('base64'), serverSideEncryption: 'AES256', ...override };
    });
    await expect(service.complete(clip.id)).rejects.toMatchObject({ code: 'verification_failed', message: expect.stringContaining(reason) });
    expect(repo.clips.get(clip.id)?.status).toBe('draft');
  });

  it('does not publish when volunteer access is not authorized, and can retry later', async () => {
    const { service, repo, sources, verifyAll } = setup();
    const { clip } = await service.register(sourceId, draft);
    verifyAll();
    vi.mocked(sources.assertUseAuthorized).mockImplementation(async (_id, use) => {
      if (use === 'volunteerAccess') throw new SourceLifecycleError('use_not_authorized', 'no');
    });
    await expect(service.complete(clip.id)).rejects.toMatchObject({ code: 'use_not_authorized' });
    expect(repo.clips.get(clip.id)?.status).toBe('draft');
    vi.mocked(sources.assertUseAuthorized).mockResolvedValue(undefined);
    expect((await service.complete(clip.id)).clip.status).toBe('published');
  });

  it('reports an unreadable object so the upload can be retried', async () => {
    const { service, store } = setup();
    const { clip } = await service.register(sourceId, draft);
    vi.mocked(store.inspectObject).mockRejectedValue(new Error('NotFound'));
    await expect(service.complete(clip.id)).rejects.toMatchObject({ code: 'object_unavailable' });
  });

  it('is idempotent: re-registering after publication re-signs nothing and applies speaker fixes', async () => {
    const { service, repo, verifyAll, store } = setup();
    const { clip } = await service.register(sourceId, draft);
    verifyAll();
    await service.complete(clip.id);
    vi.mocked(store.createUploadUrl).mockClear();
    const again = await service.register(sourceId, { ...draft, speakerRole: 'character', speakerName: 'Jesus' });
    expect(again.clip.id).toBe(clip.id);
    expect(again.files.every((f) => f.upload === null)).toBe(true);
    expect(store.createUploadUrl).not.toHaveBeenCalled();
    expect(repo.clips.get(clip.id)).toMatchObject({ speakerRole: 'character', speakerName: 'Jesus', status: 'published' });
  });

  it('restarts an unverified upload but refuses to replace verified audio or change the cut', async () => {
    const { service, verifyAll, store } = setup();
    const { clip } = await service.register(sourceId, draft);
    const retried = await service.register(sourceId, draft);
    expect(retried.files.every((f) => f.upload !== null)).toBe(true);
    verifyAll();
    await service.complete(clip.id);
    const changedAudio = { ...draft, audio: [draft.audio[0], { ...draft.audio[1], sha256: 'ee'.repeat(32) }] };
    await expect(service.register(sourceId, changedAudio)).rejects.toMatchObject({ code: 'clip_conflict' });
    await expect(service.register(sourceId, { ...draft, endMs: 7000 })).rejects.toMatchObject({ code: 'clip_conflict' });
    expect(store.createUploadUrl).toHaveBeenCalledTimes(4);
  });

  it('signs playback only for verified audio and refuses a withdrawn clip', async () => {
    const { service, verifyAll } = setup();
    const { clip } = await service.register(sourceId, draft);
    await expect(service.createAudioUrl(clip.id, 'vocals_htdemucs')).rejects.toMatchObject({ code: 'audio_not_found' });
    verifyAll();
    await service.complete(clip.id);
    await expect(service.createAudioUrl(clip.id, 'vocals_htdemucs')).resolves.toBe('https://storage.example/get');
    expect((await service.withdraw(clip.id)).clip.status).toBe('withdrawn');
    expect((await service.withdraw(clip.id)).clip.status).toBe('withdrawn');
    await expect(service.complete(clip.id)).rejects.toMatchObject({ code: 'clip_withdrawn' });
    await expect(service.register(sourceId, draft)).rejects.toMatchObject({ code: 'clip_conflict' });
  });
});
