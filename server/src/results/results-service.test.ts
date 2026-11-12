import { describe, expect, it } from 'vitest';

import type { Batch, BatchWithClips } from '../batches/batch';
import type { BatchRepository } from '../batches/batch-repository';
import type { Clip, ClipWithFiles } from '../clips/clip';
import type { ClipRepository } from '../clips/clip-repository';
import type { FinalRepository } from '../finals/final-repository';
import type { SubmissionRecord, VolunteerRepository } from '../volunteer/volunteer-repository';
import { ResultsService } from './results-service';

const projectId = '00000000-0000-4000-8000-000000000001';
const sourceId = '00000000-0000-4000-8000-000000000101';
const id = (n: number) => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`;
const [clipA, clipB, clipC] = [id(1), id(2), id(3)];

const batch = (n: number, status: 'open' | 'closed', createdAt: string): Batch => ({
  id: id(50 + n), projectId, sourceId, title: `Batch ${n}`, status, createdBy: 'ADMIN-01', createdAt, closedAt: status === 'closed' ? createdAt : null,
});
const clip = (clipId: string, key: string, status = 'published'): ClipWithFiles => ({ clip: { id: clipId, clipKey: key, durationMs: 3000, status } as Clip, files: [] });
const answer = (n: number, batchId: string, clipId: string, who: string, kind: 'transcript' | 'skip', text: string | null): SubmissionRecord => ({
  id: id(70 + n), clipId, batchId, contributorId: `person-${who}`, pseudonym: who, kind, text, createdAt: `2026-11-10T10:0${n}:00.000Z`,
});

function setup(submissions: SubmissionRecord[]) {
  const first = batch(1, 'closed', '2026-11-09T10:00:00.000Z');
  const second = batch(2, 'open', '2026-11-10T10:00:00.000Z');
  const batches: BatchWithClips[] = [{ batch: first, clipIds: [clipA, clipB] }, { batch: second, clipIds: [clipC] }];
  const service = new ResultsService(
    { listForSource: async () => batches } as unknown as BatchRepository,
    { listForSource: async () => [clip(clipA, 'c001'), clip(clipB, 'c002', 'withdrawn'), clip(clipC, 'c003')] } as unknown as ClipRepository,
    { listSubmissionsForSource: async () => submissions } as unknown as VolunteerRepository,
    { latestForSource: async () => [] } as unknown as FinalRepository,
    (batchId) => `code-for-${batchId}`,
  );
  return { service, first, second };
}

describe('ResultsService', () => {
  it('groups answers by batch and clip, newest batch first, keeping the clips in batch order', async () => {
    const { service, first, second } = setup([
      answer(1, id(51), clipA, 'Neema', 'transcript', 'mwana'),
      answer(2, id(51), clipA, 'Baraka', 'transcript', 'mwana wa'),
      answer(3, id(51), clipB, 'Neema', 'skip', null),
      answer(4, id(52), clipC, 'Cirhuza', 'transcript', 'kana'),
    ]);
    const results = await service.forSource(sourceId);
    expect(results.required).toBe(2);
    expect(results.volunteers).toBe(3);
    expect(results.batches.map((item) => item.batch.id)).toEqual([second.id, first.id]);
    const older = results.batches[1]!;
    expect(older.volunteers).toBe(2);
    expect(older.token).toBe(`code-for-${first.id}`);
    expect(older.clips.map((item) => [item.clipKey, item.position])).toEqual([['c001', 1], ['c002', 2]]);
    expect(older.clips[0]?.transcripts.map((item) => `${item.pseudonym}:${item.text}`)).toEqual(['Neema:mwana', 'Baraka:mwana wa']);
    expect(older.clips[1]).toMatchObject({ status: 'withdrawn', skips: 1, transcripts: [] });
  });

  it('counts a person once across batches and returns empty clips with no answers', async () => {
    const { service } = setup([answer(1, id(51), clipA, 'Neema', 'transcript', 'a'), answer(2, id(52), clipC, 'Neema', 'transcript', 'b')]);
    const results = await service.forSource(sourceId);
    expect(results.volunteers).toBe(1);
    const empty = await setup([]).service.forSource(sourceId);
    expect(empty.volunteers).toBe(0);
    expect(empty.batches.every((item) => item.clips.every((c) => c.transcripts.length === 0 && c.skips === 0))).toBe(true);
  });
});
