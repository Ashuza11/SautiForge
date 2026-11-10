import type { Batch, BatchWithClips } from './batch';

export interface BatchRepository {
  listForSource(sourceId: string): Promise<BatchWithClips[]>;
  getById(id: string): Promise<BatchWithClips | null>;
  countForSource(sourceId: string): Promise<number>;
  /**
   * Creates the batch and its clip rows in one statement. Returns null, and writes nothing, unless
   * every clip is published, belongs to the source, is not already in an open batch, and the source
   * still authorizes volunteer access and transcription.
   */
  createWhenEligible(batch: Batch, clipIds: string[]): Promise<BatchWithClips | null>;
  close(id: string, now: string): Promise<boolean>;
}
