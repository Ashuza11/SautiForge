import type { Clip, ClipAudioFile, ClipStatus, ClipWithFiles } from './clip';

export type ClipMetadataUpdate = Pick<Clip, 'speakerRole' | 'speakerName' | 'hasMusic' | 'tier' | 'segmenter'>;

/**
 * Methods named "...WhenAuthorized" or marked guarded must apply the source rights
 * check in the same statement that writes, so a rights change cannot slip in between.
 */
export interface ClipRepository {
  listForSource(sourceId: string, status?: ClipStatus): Promise<ClipWithFiles[]>;
  getById(id: string): Promise<ClipWithFiles | null>;
  findByKey(sourceId: string, clipKey: string): Promise<ClipWithFiles | null>;
  /** Inserts the clip and its files together. Returns null when internal processing is not authorized. */
  createWhenAuthorized(clip: Clip, files: ClipAudioFile[]): Promise<ClipWithFiles | null>;
  updateMetadata(id: string, update: ClipMetadataUpdate, updatedAt: string): Promise<boolean>;
  /** Adds a variant to an existing clip (guarded). */
  insertFile(file: ClipAudioFile): Promise<boolean>;
  /** Restarts an unverified upload with new values; never touches a verified file (guarded). */
  resetFile(file: ClipAudioFile): Promise<boolean>;
  updateFileVerification(input: {
    id: string;
    status: 'verified' | 'verification_failed';
    verificationError: string | null;
    verifiedAt: string | null;
    updatedAt: string;
  }): Promise<boolean>;
  /** Draft -> published, only when volunteer access and transcription are authorized (guarded). */
  publish(id: string, now: string): Promise<boolean>;
  withdraw(id: string, now: string): Promise<boolean>;
}
