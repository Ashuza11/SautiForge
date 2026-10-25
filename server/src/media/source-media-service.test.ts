import { describe, expect, it, vi } from 'vitest';

import type { PrivateObjectMetadata, PrivateObjectStore } from '../storage/private-object-store';
import type { Source } from '../sources/source';
import { SourceLifecycleError, type SourceService } from '../sources/source-service';
import type { SourceMedia } from './source-media';
import type { SourceMediaRepository } from './source-media-repository';
import { SourceMediaLifecycleError, SourceMediaService } from './source-media-service';

const sourceId = '00000000-0000-4000-8000-000000000101';
const projectId = '00000000-0000-4000-8000-000000000001';
const mediaId = '00000000-0000-4000-8000-000000000301';
const sha256 = '00'.repeat(32);
const checksumSha256 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const source = {
  id: sourceId,
  projectId,
  status: 'approved',
} as Source;

const draft = {
  fileName: 'master.opus',
  contentType: 'audio/ogg',
  sizeBytes: 4096,
  sha256,
  createdBy: 'ADMIN-01',
};

class MemoryMedia implements SourceMediaRepository {
  records = new Map<string, SourceMedia>();
  allowCreate = true;
  allowUpdate = true;
  async listForSource(id: string) { return [...this.records.values()].filter((record) => record.sourceId === id); }
  async getById(id: string) { return this.records.get(id) ?? null; }
  async createWhenAuthorized(media: SourceMedia) {
    if (!this.allowCreate) return null;
    this.records.set(media.id, media);
    return media;
  }
  async updateVerification(input: Parameters<SourceMediaRepository['updateVerification']>[0]) {
    const current = this.records.get(input.id);
    if (!current || !this.allowUpdate || current.status !== input.expectedStatus) return null;
    const updated: SourceMedia = { ...current, ...input };
    this.records.set(updated.id, updated);
    return updated;
  }
}

function dependencies() {
  const media = new MemoryMedia();
  const sources = {
    getDetail: vi.fn().mockResolvedValue({
      source,
      latestRights: { revision: 3, decision: 'approved', authorizedUses: { internalProcessing: true } },
    }),
    assertUseAuthorized: vi.fn().mockResolvedValue(undefined),
  } as unknown as SourceService;
  const metadata: PrivateObjectMetadata = {
    contentLengthBytes: 4096,
    contentType: 'audio/ogg',
    checksumSha256,
    serverSideEncryption: 'AES256',
  };
  const objectStore = {
    createUploadUrl: vi.fn().mockResolvedValue({
      url: 'https://storage.example/signed',
      headers: {
        'content-type': 'audio/ogg',
        'x-amz-checksum-sha256': checksumSha256,
        'x-amz-server-side-encryption': 'AES256',
      },
    }),
    inspectObject: vi.fn().mockResolvedValue(metadata),
  } as unknown as PrivateObjectStore;
  const service = new SourceMediaService(media, sources, objectStore, {
    idFactory: () => mediaId,
    now: () => new Date('2026-10-25T10:00:00.000Z'),
    uploadExpirySeconds: 300,
  });
  return { service, media, sources, objectStore, metadata };
}

describe('SourceMediaService', () => {
  it('does not sign an upload for a missing source', async () => {
    const { service, sources, objectStore } = dependencies();
    vi.mocked(sources.getDetail).mockResolvedValue(null);
    await expect(service.initiateUpload(sourceId, draft)).rejects.toMatchObject({ code: 'source_not_found' });
    expect(objectStore.createUploadUrl).not.toHaveBeenCalled();
  });

  it('creates a rights-bound pending record and returns all required signed upload headers', async () => {
    const { service, media, sources, objectStore } = dependencies();
    const result = await service.initiateUpload(sourceId, draft);

    expect(sources.assertUseAuthorized).toHaveBeenCalledWith(sourceId, 'internalProcessing');
    expect(objectStore.createUploadUrl).toHaveBeenCalledWith(expect.objectContaining({
      key: `projects/${projectId}/sources/${sourceId}/masters/${mediaId}`,
      contentLengthBytes: 4096,
      checksumSha256,
    }));
    expect(result.media).toMatchObject({
      id: mediaId,
      sourceId,
      projectId,
      rightsRevision: 3,
      status: 'upload_pending',
      uploadExpiresAt: '2026-10-25T10:05:00.000Z',
    });
    expect(result.upload.headers['x-amz-checksum-sha256']).toBe(checksumSha256);
    expect(media.records.get(mediaId)).toEqual(result.media);
  });

  it('stops before signing when internal processing is not authorized', async () => {
    const { service, sources, objectStore } = dependencies();
    vi.mocked(sources.assertUseAuthorized).mockRejectedValue(new SourceLifecycleError('use_not_authorized', 'not allowed'));
    await expect(service.initiateUpload(sourceId, draft)).rejects.toMatchObject({ code: 'use_not_authorized' });
    expect(objectStore.createUploadUrl).not.toHaveBeenCalled();
  });

  it('fails closed if rights change between signing and the guarded database insert', async () => {
    const { service, media } = dependencies();
    media.allowCreate = false;
    await expect(service.initiateUpload(sourceId, draft)).rejects.toMatchObject({ code: 'source_changed' });
    expect(media.records.size).toBe(0);
  });

  it('marks a master verified only after exact storage metadata matches', async () => {
    const { service } = dependencies();
    await service.initiateUpload(sourceId, draft);
    await expect(service.completeUpload(mediaId)).resolves.toMatchObject({
      status: 'verified',
      verificationError: null,
      verifiedAt: '2026-10-25T10:00:00.000Z',
    });
    await expect(service.completeUpload(mediaId)).resolves.toMatchObject({ status: 'verified' });
  });

  it.each([
    ['size_mismatch', { contentLengthBytes: 4095 }],
    ['content_type_mismatch', { contentType: 'audio/mpeg' }],
    ['checksum_mismatch', { checksumSha256: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=' }],
    ['encryption_missing', { serverSideEncryption: null }],
  ])('records %s without claiming the upload is verified', async (reason, change) => {
    const { service, objectStore, metadata, media } = dependencies();
    vi.mocked(objectStore.inspectObject).mockResolvedValue({ ...metadata, ...change });
    await service.initiateUpload(sourceId, draft);
    await expect(service.completeUpload(mediaId)).rejects.toMatchObject({ code: 'verification_failed' });
    expect(media.records.get(mediaId)).toMatchObject({ status: 'verification_failed', verificationError: reason, verifiedAt: null });
  });

  it('keeps an unavailable object pending so completion can be retried', async () => {
    const { service, objectStore, media } = dependencies();
    vi.mocked(objectStore.inspectObject).mockRejectedValue(new Error('not found'));
    await service.initiateUpload(sourceId, draft);
    await expect(service.completeUpload(mediaId)).rejects.toMatchObject({ code: 'object_unavailable' });
    expect(media.records.get(mediaId)?.status).toBe('upload_pending');
  });

  it('does not verify media when rights are revoked during object inspection', async () => {
    const { service, media } = dependencies();
    await service.initiateUpload(sourceId, draft);
    media.allowUpdate = false;
    await expect(service.completeUpload(mediaId)).rejects.toMatchObject({ code: 'source_changed' });
    expect(media.records.get(mediaId)?.status).toBe('upload_pending');
  });

  it('does not permit retrying a permanently failed upload record', async () => {
    const { service, objectStore, metadata } = dependencies();
    vi.mocked(objectStore.inspectObject).mockResolvedValue({ ...metadata, contentLengthBytes: 1 });
    await service.initiateUpload(sourceId, draft);
    await expect(service.completeUpload(mediaId)).rejects.toBeInstanceOf(SourceMediaLifecycleError);
    await expect(service.completeUpload(mediaId)).rejects.toMatchObject({ code: 'upload_not_pending' });
  });
});
