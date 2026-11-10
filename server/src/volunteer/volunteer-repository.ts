import type { Contributor, NextClip, Submission } from './volunteer';

export type BatchProgress = { total: number; answered: number };

export type SubmissionRecord = {
  id: string;
  clipId: string;
  batchId: string;
  contributorId: string;
  pseudonym: string;
  kind: 'transcript' | 'skip';
  text: string | null;
  createdAt: string;
};

export interface VolunteerRepository {
  /** Every answer given in the batches of one source, oldest first. For admins only. */
  listSubmissionsForSource(sourceId: string): Promise<SubmissionRecord[]>;
  createContributor(contributor: Contributor): Promise<Contributor>;
  getContributor(id: string): Promise<Contributor | null>;
  /**
   * The first clip of the batch, in order, that this person has not answered and that still needs
   * transcripts. Published clips only. Never returns anyone's text.
   */
  nextClip(batchId: string, contributorId: string, requiredTranscripts: number): Promise<NextClip | null>;
  /** `total` is this person's answers plus the clips still open to them, so the count is never longer than their own work. */
  progress(batchId: string, contributorId: string, requiredTranscripts: number): Promise<BatchProgress>;
  /**
   * Appends an answer. Returns 'recorded', 'already_answered' when this person already answered the
   * clip (nothing changes), or 'unavailable' when the batch is closed, the clip is not in it or is no
   * longer published, the person belongs to another project, or the source no longer allows it.
   */
  appendSubmission(submission: Submission): Promise<'recorded' | 'already_answered' | 'unavailable'>;
}
