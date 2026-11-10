import { createHash, randomUUID } from 'node:crypto';

import type { SourceService } from '../sources/source-service';
import type { PrivateObjectStore, SignedUpload } from '../storage/private-object-store';
import {
  CONTENT_TYPE_BY_VARIANT,
  FILE_EXTENSION_BY_VARIANT,
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
import { FlacError, readFlacInfo } from './flac';

export class ClipLifecycleError extends Error {
  constructor(
    readonly code: 'source_not_found' | 'clip_not_found' | 'audio_not_found' | 'clip_withdrawn' | 'clip_conflict'
      | 'upload_not_pending' | 'object_unavailable' | 'verification_failed' | 'source_changed' | 'unsupported_audio',
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
    const uploadByFile = new Map(files.map((file, index) => [file.id, uploads[index] ?? null]));
    return { clip: saved.clip, files: saved.files.map((file) => ({ file, upload: uploadByFile.get(file.id) ?? null })) };
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
      } else if (current.status === 'verified' && audio.variant === 'listening') {
        // The listening copy is derived and may be re-encoded differently on another machine; keep the stored one.
        results.push({ file: current, upload: null });
      } else if (current.status === 'verified') {
        if (current.sha256 !== audio.sha256 || current.sizeBytes !== audio.sizeBytes || current.derivedFrom !== audio.derivedFrom) {
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

  /**
   * Accepts one FLAC file from the admin's browser: checks it, stores it, verifies it and publishes the clip.
   * Safe to repeat for the same clip key with the same file; a different file under the same key is refused.
   */
  async uploadFlac(sourceId: string, input: { clipKey: string; bytes: Uint8Array; createdBy: string }): Promise<ClipWithFiles> {
    let info;
    try {
      info = readFlacInfo(input.bytes);
    } catch (error) {
      if (error instanceof FlacError) throw new ClipLifecycleError('unsupported_audio', error.message);
      throw error;
    }
    if (info.channels !== 1 || info.bitsPerSample !== 16) {
      throw new ClipLifecycleError('unsupported_audio', 'Use mono 16-bit FLAC files, as made by the pack command.');
    }
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const draft = clipDraftSchema.parse({
      clipKey: input.clipKey,
      startMs: 0,
      endMs: info.durationMs,
      trimmedMs: 0,
      durationMs: info.durationMs,
      speakerRole: 'unknown',
      speakerName: null,
      hasMusic: false,
      tier: 'asr',
      segmenter: 'browser-upload',
      createdBy: input.createdBy,
      audio: [{ variant: 'master', derivedFrom: 'cleaned', sizeBytes: input.bytes.length, sha256, pcmSha256: null, sampleRate: info.sampleRate, durationMs: info.durationMs }],
    });
    const registered = await this.register(sourceId, draft);
    for (const { file, upload } of registered.files) {
      if (!upload) continue;
      await this.objectStore.putObject({
        key: file.objectKey,
        contentType: file.contentType,
        checksumSha256: Buffer.from(file.sha256, 'hex').toString('base64'),
        body: input.bytes,
      });
    }
    return this.complete(registered.clip.id);
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
      const failure = verificationFailure(file, observed, this.objectStore.reportsEncryption);
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
    const verified = (wanted: ClipVariant) => current?.files.find((candidate) => candidate.variant === wanted && candidate.status === 'verified');
    // Browser-uploaded clips have only the FLAC master, which is also what plays.
    const file = verified(variant) ?? (variant === 'listening' ? verified('master') : undefined);
    if (!current || !file) throw new ClipLifecycleError('audio_not_found', 'No verified audio exists for this clip and variant.');
    await this.sources.assertUseAuthorized(current.clip.sourceId, 'internalProcessing');
    return this.objectStore.createDownloadUrl(file.objectKey, 300);
  }

  /** A short-lived link for a volunteer to listen to a published clip. Volunteer access must be authorized. */
  async createListeningUrl(clipId: string): Promise<string> {
    const current = await this.clips.getById(clipId);
    // The FLAC master plays in every current browser, so it is preferred over the optional Opus copy.
    const file = current?.files.find((f) => f.variant === 'master' && f.status === 'verified')
      ?? current?.files.find((f) => f.variant === 'listening' && f.status === 'verified');
    if (!current || current.clip.status !== 'published' || !file) {
      throw new ClipLifecycleError('audio_not_found', 'No published audio exists for this clip.');
    }
    await this.sources.assertUseAuthorized(current.clip.sourceId, 'volunteerAccess');
    return this.objectStore.createDownloadUrl(file.objectKey, 900);
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
      derivedFrom: audio.derivedFrom,
      objectKey: `projects/${clip.projectId}/sources/${clip.sourceId}/clips/${clip.id}/${audio.variant}.${FILE_EXTENSION_BY_VARIANT[audio.variant]}`,
      contentType: CONTENT_TYPE_BY_VARIANT[audio.variant],
      sizeBytes: audio.sizeBytes,
      sha256: audio.sha256,
      pcmSha256: audio.pcmSha256,
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
  reportsEncryption: boolean,
): string | null {
  const expectedChecksum = Buffer.from(expected.sha256, 'hex').toString('base64');
  if (observed.contentLengthBytes !== expected.sizeBytes) return 'size_mismatch';
  if (observed.contentType.toLowerCase() !== expected.contentType) return 'content_type_mismatch';
  if (observed.checksumSha256 !== expectedChecksum) return 'checksum_mismatch';
  if (reportsEncryption && !['AES256', 'aws:kms'].includes(observed.serverSideEncryption ?? '')) return 'encryption_missing';
  return null;
}
