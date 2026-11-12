import type { BatchRepository } from '../batches/batch-repository';
import type { ClipRepository } from '../clips/clip-repository';
import { REQUIRED_TRANSCRIPTS } from '../volunteer/volunteer';
import type { FinalRepository } from '../finals/final-repository';
import type { VolunteerRepository } from '../volunteer/volunteer-repository';

export type TranscriptView = { id: string; contributorId: string; pseudonym: string; text: string; /** The form this person thinks is correct, if they wrote one. */ correction: string | null; createdAt: string };

export type ClipResult = {
  clipId: string;
  clipKey: string;
  durationMs: number;
  position: number;
  /** published or withdrawn; a withdrawn clip keeps its answers for the record. */
  status: string;
  transcripts: TranscriptView[];
  skips: number;
  /** The newest final decision, or null when the admin has not decided yet. */
  final: { version: number; decision: 'approved' | 'excluded'; text: string | null; note: string; createdAt: string } | null;
};

export type BatchResult = {
  batch: { id: string; title: string; status: 'open' | 'closed'; createdAt: string };
  /** The code at the end of the batch link, so the admin can build links to single clips. */
  token: string;
  clips: ClipResult[];
  /** Distinct people who answered anything in this batch. */
  volunteers: number;
};

export type SourceResults = { required: number; volunteers: number; batches: BatchResult[] };

/** Read-only view of what volunteers wrote, for the admin. Nothing here changes any answer. */
export class ResultsService {
  constructor(
    private readonly batches: BatchRepository,
    private readonly clips: ClipRepository,
    private readonly volunteer: VolunteerRepository,
    private readonly finals: FinalRepository,
    private readonly tokenFor: (batchId: string) => string = () => '',
  ) {}

  async forSource(sourceId: string): Promise<SourceResults> {
    const [batches, clips, submissions, latestFinals] = await Promise.all([
      this.batches.listForSource(sourceId),
      this.clips.listForSource(sourceId),
      this.volunteer.listSubmissionsForSource(sourceId),
      this.finals.latestForSource(sourceId),
    ]);
    const finalByClip = new Map(latestFinals.map((item) => [item.clipId, item]));
    const clipById = new Map(clips.map((item) => [item.clip.id, item.clip]));
    const everyone = new Set<string>();

    const results: BatchResult[] = batches.map(({ batch, clipIds }) => {
      const inBatch = submissions.filter((submission) => submission.batchId === batch.id);
      const people = new Set(inBatch.map((submission) => submission.contributorId));
      people.forEach((id) => everyone.add(id));
      return {
        batch: { id: batch.id, title: batch.title, status: batch.status, createdAt: batch.createdAt },
        token: this.tokenFor(batch.id),
        volunteers: people.size,
        clips: clipIds.map((clipId, index): ClipResult => {
          const clip = clipById.get(clipId);
          const mine = inBatch.filter((submission) => submission.clipId === clipId);
          return {
            clipId,
            clipKey: clip?.clipKey ?? '',
            durationMs: clip?.durationMs ?? 0,
            position: index + 1,
            status: clip?.status ?? 'unknown',
            transcripts: mine
              .filter((submission) => submission.kind === 'transcript' && submission.text !== null)
              .map((submission) => ({ id: submission.id, contributorId: submission.contributorId, pseudonym: submission.pseudonym, text: submission.text ?? '', correction: submission.correction, createdAt: submission.createdAt })),
            skips: mine.filter((submission) => submission.kind === 'skip').length,
            final: (() => {
              const record = finalByClip.get(clipId);
              return record ? { version: record.version, decision: record.decision, text: record.text, note: record.note, createdAt: record.createdAt } : null;
            })(),
          };
        }),
      };
    });
    return { required: REQUIRED_TRANSCRIPTS, volunteers: everyone.size, batches: results.reverse() };
  }
}
