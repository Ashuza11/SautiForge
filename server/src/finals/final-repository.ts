import type { FinalTranscript } from './final';

export interface FinalRepository {
  /**
   * Appends the next version for the clip, numbered in the same statement. Returns null, writing
   * nothing, when the clip is not in a batch or the chosen answer does not belong to the clip.
   */
  append(record: Omit<FinalTranscript, 'version'>): Promise<FinalTranscript | null>;
  /** The newest version of each clip's final text in one source. */
  latestForSource(sourceId: string): Promise<FinalTranscript[]>;
  historyForClip(clipId: string): Promise<FinalTranscript[]>;
}
