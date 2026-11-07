import { randomUUID } from 'node:crypto';

import type { SourceService } from '../sources/source-service';
import type { PrivateObjectStore, SignedUpload } from '../storage/private-object-store';
import {
  clipAudioFileSchema,
  clipDraftSchema,
  clipSchema,
  type Clip,
  type ClipAudioDraft,
  type ClipAudioFile,
  type ClipDraft,
  type ClipStatus,
  type ClipVariant,
  type ClipWithFiles,
} from './clip';
import type { ClipRepository } from './clip-repository';

export class ClipLifecycleError extends Error {
  constructor(
    readonly code: 'source_not_found' | 'clip_not_found' | 'audio_not_found' | 'clip_withdrawn' | 'clip_conflict'
      | 'upload_not_pending' | 'object_unavailable' | 'verification_failed' | 'source_changed',
    message: string,
  ) {
    super(message);
  }
}

export type ClipServiceOptions = {
  idFactory?: () => string;
  now?: () => Date;
  uploadExpirySeconds?: number;
};

export type RegisteredClip = {
  clip: Clip;
  files: { file: ClipAudioFile; upload: SignedUpload | null }[];
};

export class ClipService {
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly uploadExpirySeconds: number;

  constructor(
    private readonly clips: ClipRepository,
    private readonly sources: SourceService,
    private readonly objectStore: PrivateObjectStore,
    options: ClipServiceOptions = {},
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.uploadExpirySeconds = options.uploadExpirySeconds ?? 300;
  }

  listForSource(sourceId: string, status?: ClipStatus): Promise<ClipWithFiles[]> {
    return this.clips.listForSource(sourceId, status);
  }

  /**
   * Registers a clip and signs uploads for its audio. Safe to repeat: verified audio is
   * never replaced, unverified audio gets a fresh upload, speaker/tier changes are applied.
   */
  async register(sourceId: string, input: ClipDraft): Promise<RegisteredClip> {
    const detail = await this.sources.getDetail(sourceId);
    if (!detail) throw new ClipLifecycleError('source_not_found', 'The source does not exist.');
    await this.sources.assertUseAuthorized(sourceId, 'internalProcessing');
    const rightsRevision = detail.latestRights?.revision;
    if (!rightsRevision) throw new ClipLifecycleError('source_changed', 'Reload the source rights before publishing clips.');

    const draft = clipDraftSchema.parse(input);
    const existing = await this.clips.findByKey(sourceId, draft.clipKey);
    if (existing) return this.registerAgain(existing, draft);

    const clipId = this.idFactory();
    const timestamp = this.now().toISOString();
    const clip = clipSchema.parse({
      id: clipId,
      projectId: detail.source.projectId,
      sourceId,
      rightsRevision,
      clipKey: draft.clipKey,
      startMs: draft.startMs,
      endMs: draft.endMs,
      trimmedMs: draft.trimmedMs,
      durationMs: draft.durationMs,
      speakerRole: draft.speakerRole,
      speakerName: draft.speakerName,
      hasMusic: draft.hasMusic,
      tier: draft.tier,
      status: 'draft',
      segmenter: draft.segmenter,
      createdBy: draft.createdBy,
      createdAt: timestamp,
      updatedAt: timestamp,
      publishedAt: null,
      withdrawnAt: null,
    });
    const files = draft.audio.map((audio) => this.newFile(clip, audio, timestamp));
    const uploads = await Promise.all(files.map((file) => this.sign(file)));
    const saved = await this.clips.createWhenAuthorized(clip, files);
    if (!saved) {
      throw new ClipLifecycleError('source_changed', 'The source permission changed before the clip was created. Reload and try again.');
    }
    return { clip: saved.clip, files: saved.files.map((file, index) => ({ file, upload: uploads[index] ?? null })) };
  }

  private async registerAgain(existing: ClipWithFiles, draft: ClipDraft): Promise<RegisteredClip> {
    const { clip } = existing;
    if (clip.status === 'withdrawn') {
      throw new ClipLifecycleError('clip_conflict', 'This clip was withdrawn. Use a new clip key to publish it again.');
    }
    if (clip.startMs !== draft.startMs || clip.endMs !== draft.endMs || clip.trimmedMs !== draft.trimmedMs || clip.durationMs !== draft.durationMs) {
      throw new ClipLifecycleError('clip_conflict', 'The cut points differ from the stored clip. Withdraw it and use a new clip key.');
    }
    const timestamp = this.now().toISOString();
    if (
      clip.speakerRole !== draft.speakerRole || clip.speakerName !== draft.speakerName ||
      clip.hasMusic !== draft.hasMusic || clip.tier !== draft.tier || clip.segmenter !== draft.segmenter
    ) {
      const updated = await this.clips.updateMetadata(clip.id, {
        speakerRole: draft.speakerRole,
        speakerName: draft.speakerName,
        hasMusic: draft.hasMusic,
        tier: draft.tier,
        segmenter: draft.segmenter,
      }, timestamp);
      if (!updated) throw new ClipLifecycleError('source_changed', 'The source permission changed. Reload and try again.');
    }

    const results: RegisteredClip['files'] = [];
    for (const audio of draft.audio) {
      const current = existing.files.find((file) => file.variant === audio.variant);
      if (!current) {
        const file = this.newFile(clip, audio, timestamp);
        const upload = await this.sign(file);
        if (!await this.clips.insertFile(file)) {
          throw new ClipLifecycleError('source_changed', 'The source permission changed. Reload and try again.');
        }
        results.push({ file, upload });
      } else if (current.status === 'verified') {
        if (current.sha256 !== audio.sha256 || current.sizeBytes !== audio.sizeBytes) {
          throw new ClipLifecycleError('clip_conflict', `The ${audio.variant} audio is already verified with different content. Withdraw the clip and use a new clip key.`);
        }
        results.push({ file: current, upload: null });
      } else {
        const file: ClipAudioFile = clipAudioFileSchema.parse({
          ...this.newFile(clip, audio, timestamp),
          id: current.id,
          createdAt: current.createdAt,
        });
        const upload = await this.sign(file);
        if (!await this.clips.resetFile(file)) {
          throw new ClipLifecycleError('source_changed', 'The source permission or upload state changed. Reload and try again.');
        }
        results.push({ file, upload });
      }
    }
    return { clip: { ...clip, ...draftMetadata(draft), updatedAt: timestamp }, files: results };
  }

  /** Verifies the uploaded objects and publishes the clip once the cleaned audio is verified. */
  async complete(clipId: string): Promise<ClipWithFiles> {
    const current = await this.clips.getById(clipId);
    if (!current) throw new ClipLifecycleError('clip_not_found', 'The clip does not exist.');
    if (current.clip.status === 'withdrawn') throw new ClipLifecycleError('clip_withdrawn', 'This clip was withdrawn.');
    await this.sources.assertUseAuthorized(current.clip.sourceId, 'internalProcessing');

    let firstFailure: string | null = null;
    for (const file of current.files) {
      if (file.status === 'verified') continue;
      if (file.status === 'verification_failed') {
        throw new ClipLifecycleError('upload_not_pending', 'An earlier upload failed verification. Publish the clip again to restart it.');
      }
      let observed;
      try {
        observed = await this.objectStore.inspectObject(file.objectKey);
      } catch {
        throw new ClipLifecycleError('object_unavailable', 'An uploaded file is not readable yet. Confirm the upload completed and retry.');
      }
      const failure = verificationFailure(file, observed);
      const timestamp = this.now().toISOString();
      const saved = await this.clips.updateFileVerification({
        id: file.id,
        status: failure ? 'verification_failed' : 'verified',
        verificationError: failure,
        verifiedAt: failure ? null : timestamp,
        updatedAt: timestamp,
      });
      if (!saved) throw new ClipLifecycleError('source_changed', 'The source permission or upload state changed during verification.');
      firstFailure ??= failure;
    }
    if (firstFailure) {
      throw new ClipLifecycleError('verification_failed', `An uploaded file failed verification: ${firstFailure}.`);
    }

    if (current.clip.status === 'draft') {
      await this.sources.assertUseAuthorized(current.clip.sourceId, 'volunteerAccess');
      await this.sources.assertUseAuthorized(current.clip.sourceId, 'transcription');
      if (!await this.clips.publish(clipId, this.now().toISOString())) {
        throw new ClipLifecycleError('source_changed', 'The source permission changed before publishing. Reload and try again.');
      }
    }
    const fresh = await this.clips.getById(clipId);
    if (!fresh) throw new ClipLifecycleError('clip_not_found', 'The clip does not exist.');
    return fresh;
  }

  async createAudioUrl(clipId: string, variant: ClipVariant): Promise<string> {
    const current = await this.clips.getById(clipId);
    const file = current?.files.find((candidate) => candidate.variant === variant && candidate.status === 'verified');
    if (!current || !file) throw new ClipLifecycleError('audio_not_found', 'No verified audio exists for this clip and variant.');
    await this.sources.assertUseAuthorized(current.clip.sourceId, 'internalProcessing');
    return this.objectStore.createDownloadUrl(file.objectKey, 300);
  }

  async withdraw(clipId: string): Promise<ClipWithFiles> {
    const current = await this.clips.getById(clipId);
    if (!current) throw new ClipLifecycleError('clip_not_found', 'The clip does not exist.');
    if (current.clip.status !== 'withdrawn') await this.clips.withdraw(clipId, this.now().toISOString());
    const fresh = await this.clips.getById(clipId);
    if (!fresh) throw new ClipLifecycleError('clip_not_found', 'The clip does not exist.');
    return fresh;
  }

  private newFile(clip: Clip, audio: ClipAudioDraft, timestamp: string): ClipAudioFile {
    return clipAudioFileSchema.parse({
      id: this.idFactory(),
      clipId: clip.id,
      variant: audio.variant,
      objectKey: `projects/${clip.projectId}/sources/${clip.sourceId}/clips/${clip.id}/${audio.variant}.wav`,
      contentType: 'audio/wav',
      sizeBytes: audio.sizeBytes,
      sha256: audio.sha256,
      sampleRate: audio.sampleRate,
      durationMs: audio.durationMs,
      status: 'upload_pending',
      verificationError: null,
      uploadExpiresAt: new Date(this.now().getTime() + this.uploadExpirySeconds * 1000).toISOString(),
      verifiedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private sign(file: ClipAudioFile): Promise<SignedUpload> {
    return this.objectStore.createUploadUrl({
      key: file.objectKey,
      contentType: file.contentType,
      checksumSha256: Buffer.from(file.sha256, 'hex').toString('base64'),
      contentLengthBytes: file.sizeBytes,
      expiresInSeconds: this.uploadExpirySeconds,
    });
  }
}

function draftMetadata(draft: ClipDraft) {
  return {
    speakerRole: draft.speakerRole,
    speakerName: draft.speakerName,
    hasMusic: draft.hasMusic,
    tier: draft.tier,
    segmenter: draft.segmenter,
  };
}

function verificationFailure(
  expected: Pick<ClipAudioFile, 'sizeBytes' | 'contentType' | 'sha256'>,
  observed: Awaited<ReturnType<PrivateObjectStore['inspectObject']>>,
): string | null {
  const expectedChecksum = Buffer.from(expected.sha256, 'hex').toString('base64');
  if (observed.contentLengthBytes !== expected.sizeBytes) return 'size_mismatch';
  if (observed.contentType.toLowerCase() !== expected.contentType) return 'content_type_mismatch';
  if (observed.checksumSha256 !== expectedChecksum) return 'checksum_mismatch';
  if (!['AES256', 'aws:kms'].includes(observed.serverSideEncryption ?? '')) return 'encryption_missing';
  return null;
}
