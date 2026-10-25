import { randomUUID } from 'node:crypto';

import type { SourceService } from '../sources/source-service';
import type { PrivateObjectStore } from '../storage/private-object-store';
import {
  sourceMediaSchema,
  sourceMediaUploadDraftSchema,
  type SourceMedia,
  type SourceMediaUploadDraft,
} from './source-media';
import type { SourceMediaRepository } from './source-media-repository';

export class SourceMediaLifecycleError extends Error {
  constructor(
    readonly code: 'source_not_found' | 'media_not_found' | 'upload_not_pending' | 'object_unavailable' | 'verification_failed' | 'source_changed',
    message: string,
  ) {
    super(message);
  }
}

export type SourceMediaServiceOptions = {
  idFactory?: () => string;
  now?: () => Date;
  uploadExpirySeconds?: number;
};

export class SourceMediaService {
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly uploadExpirySeconds: number;

  constructor(
    private readonly media: SourceMediaRepository,
    private readonly sources: SourceService,
    private readonly objectStore: PrivateObjectStore,
    options: SourceMediaServiceOptions = {},
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.uploadExpirySeconds = options.uploadExpirySeconds ?? 300;
  }

  listForSource(sourceId: string): Promise<SourceMedia[]> {
    return this.media.listForSource(sourceId);
  }

  async initiateUpload(sourceId: string, input: SourceMediaUploadDraft) {
    const detail = await this.sources.getDetail(sourceId);
    if (!detail) throw new SourceMediaLifecycleError('source_not_found', 'The source does not exist.');
    await this.sources.assertUseAuthorized(sourceId, 'internalProcessing');
    const rightsRevision = detail.latestRights?.revision;
    if (!rightsRevision) throw new SourceMediaLifecycleError('source_changed', 'Reload the source rights before uploading media.');

    const draft = sourceMediaUploadDraftSchema.parse(input);
    const id = this.idFactory();
    const now = this.now();
    const objectKey = `projects/${detail.source.projectId}/sources/${sourceId}/masters/${id}`;
    const checksumSha256 = Buffer.from(draft.sha256, 'hex').toString('base64');
    const upload = await this.objectStore.createUploadUrl({
      key: objectKey,
      contentType: draft.contentType,
      checksumSha256,
      contentLengthBytes: draft.sizeBytes,
      expiresInSeconds: this.uploadExpirySeconds,
    });
    const record = sourceMediaSchema.parse({
      ...draft,
      id,
      projectId: detail.source.projectId,
      sourceId,
      rightsRevision,
      objectKey,
      status: 'upload_pending',
      verificationError: null,
      uploadExpiresAt: new Date(now.getTime() + this.uploadExpirySeconds * 1000).toISOString(),
      verifiedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const saved = await this.media.createWhenAuthorized(record);
    if (!saved) {
      throw new SourceMediaLifecycleError('source_changed', 'The source permission changed before the upload was created. Reload and try again.');
    }
    return { media: saved, upload };
  }

  async completeUpload(mediaId: string): Promise<SourceMedia> {
    const current = await this.media.getById(mediaId);
    if (!current) throw new SourceMediaLifecycleError('media_not_found', 'The source media record does not exist.');
    if (current.status === 'verified') return current;
    if (current.status !== 'upload_pending') {
      throw new SourceMediaLifecycleError('upload_not_pending', 'This upload can no longer be verified. Start a new upload.');
    }
    await this.sources.assertUseAuthorized(current.sourceId, 'internalProcessing');

    let observed;
    try {
      observed = await this.objectStore.inspectObject(current.objectKey);
    } catch {
      throw new SourceMediaLifecycleError('object_unavailable', 'The uploaded object is not readable yet. Confirm the upload completed and retry.');
    }

    const expectedChecksum = Buffer.from(current.sha256, 'hex').toString('base64');
    const failure = verificationFailure(current, observed, expectedChecksum);
    const timestamp = this.now().toISOString();
    const saved = await this.media.updateVerification({
      id: current.id,
      expectedStatus: 'upload_pending',
      status: failure ? 'verification_failed' : 'verified',
      verificationError: failure,
      verifiedAt: failure ? null : timestamp,
      updatedAt: timestamp,
    });
    if (!saved) {
      throw new SourceMediaLifecycleError('source_changed', 'The source permission or upload state changed during verification. Reload before continuing.');
    }
    if (failure) {
      throw new SourceMediaLifecycleError('verification_failed', `The uploaded object failed verification: ${failure}.`);
    }
    return saved;
  }
}

function verificationFailure(
  expected: Pick<SourceMedia, 'sizeBytes' | 'contentType'>,
  observed: Awaited<ReturnType<PrivateObjectStore['inspectObject']>>,
  expectedChecksum: string,
): string | null {
  if (observed.contentLengthBytes !== expected.sizeBytes) return 'size_mismatch';
  if (observed.contentType.toLowerCase() !== expected.contentType) return 'content_type_mismatch';
  if (observed.checksumSha256 !== expectedChecksum) return 'checksum_mismatch';
  if (!['AES256', 'aws:kms'].includes(observed.serverSideEncryption ?? '')) return 'encryption_missing';
  return null;
}
