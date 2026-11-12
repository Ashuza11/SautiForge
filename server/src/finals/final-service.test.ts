import { describe, expect, it, vi } from 'vitest';

import type { Clip, ClipAudioFile, ClipWithFiles } from '../clips/clip';
import type { ClipRepository } from '../clips/clip-repository';
import type { ProjectService } from '../projects/project-service';
import type { Source, SourceRightsRevision } from '../sources/source';
import type { SourceService } from '../sources/source-service';
import type { PrivateObjectStore } from '../storage/private-object-store';
import type { SubmissionRecord, VolunteerRepository } from '../volunteer/volunteer-repository';
import type { FinalTranscript } from './final';
import type { FinalRepository } from './final-repository';
import { FinalError, FinalService } from './final-service';

const projectId = '00000000-0000-4000-8000-000000000001';
const sourceId = '00000000-0000-4000-8000-000000000101';
const id = (n: number) => `00000000-0000-4000-8000-0000000008${String(n).padStart(2, '0')}`;
const [clipA, clipB, clipC, clipD] = [id(1), id(2), id(10), id(11)];

class MemoryFinals implements FinalRepository {
  rows: FinalTranscript[] = [];
  eligible = true;
  failOnce: unknown = null;
  async append(record: Omit<FinalTranscript, 'version'>) {
    if (this.failOnce) { const error = this.failOnce; this.failOnce = null; throw error; }
    if (!this.eligible) return null;
    const version = this.rows.filter((row) => row.clipId === record.clipId).length + 1;
    const saved = { ...record, version };
    this.rows.push(saved);
    return saved;
  }
  async latestForSource() {
    const latest = new Map<string, FinalTranscript>();
    for (const row of this.rows) latest.set(row.clipId, row);
    return [...latest.values()];
  }
  async historyForClip(clipId: string) { return this.rows.filter((row) => row.clipId === clipId); }
}

const master = (clipId: string): ClipAudioFile => ({
  id: `file-${clipId}`, clipId, variant: 'master', derivedFrom: 'cleaned', objectKey: `clips/${clipId}/master.flac`, contentType: 'audio/flac',
  sizeBytes: 5000, sha256: 'a'.repeat(64), pcmSha256: null, sampleRate: 24000, durationMs: 3000, status: 'verified',
  verificationError: null, uploadExpiresAt: '2026-11-10T10:00:00.000Z', verifiedAt: '2026-11-10T10:00:00.000Z', createdAt: '2026-11-10T10:00:00.000Z', updatedAt: '2026-11-10T10:00:00.000Z',
});
const entry = (clipId: string, key: string, status = 'published', durationMs = 3000): ClipWithFiles => ({
  clip: { id: clipId, clipKey: key, durationMs, status } as Clip,
  files: [master(clipId)],
});
const answer = (n: number, clipId: string, who: string): SubmissionRecord => ({
  id: id(40 + n), clipId, batchId: id(60), contributorId: who, pseudonym: who, kind: 'transcript', text: 't', correction: null, createdAt: '2026-11-10T10:00:00.000Z',
});

function setup() {
  let counter = 0;
  const finals = new MemoryFinals();
  const clips = {
    getById: vi.fn().mockImplementation(async (clipId: string) => (clipId === id(99) ? null : entry(clipId, 'c'))),
    listForSource: vi.fn().mockResolvedValue([entry(clipA, 'c001'), entry(clipB, 'c002'), entry(clipC, 'c010'), entry(clipD, 'c011', 'withdrawn')]),
  } as unknown as ClipRepository;
  const volunteer = {
    listSubmissionsForSource: vi.fn().mockResolvedValue([answer(1, clipA, 'p1'), answer(2, clipA, 'p2'), answer(3, clipA, 'p1')]),
  } as unknown as VolunteerRepository;
  const sources = {
    getDetail: vi.fn().mockResolvedValue({
      source: { id: sourceId, projectId, title: 'A film', originalUrl: 'https://example.org/v', creator: 'Maker' } as Source,
      latestRights: { decision: 'approved', rightsHolder: 'Owner', license: null, permissionEvidence: 'note', attributionRequirements: null, authorizedUses: { internalProcessing: true, volunteerAccess: true, transcription: true, mlResearch: false, publicDistribution: false } } as SourceRightsRevision,
    }),
  } as unknown as SourceService;
  const projects = { getById: vi.fn().mockResolvedValue({ title: 'Mashi corpus', languageCode: 'shr', targetLanguage: 'Shi', languageVariety: 'Mashi' }) } as unknown as ProjectService;
  const store = { createDownloadUrl: vi.fn().mockImplementation(async (key: string) => `https://storage.example/${key}`) } as unknown as PrivateObjectStore;
  const service = new FinalService(finals, clips, volunteer, sources, projects, store, {
    idFactory: () => id(70 + ++counter),
    now: () => new Date('2026-11-10T12:00:00.000Z'),
  });
  return { service, finals, clips, store, sources };
}

describe('FinalService.record', () => {
  it('appends a new version each time and never changes an earlier one', async () => {
    const { service, finals } = setup();
    const first = await service.record(clipA, { decision: 'approved', text: ' mwana  wa ', chosenSubmissionId: id(41), note: '' }, 'ADMIN-01');
    expect(first).toMatchObject({ version: 1, decision: 'approved', text: 'mwana wa', chosenSubmissionId: id(41), createdBy: 'ADMIN-01', createdAt: '2026-11-10T12:00:00.000Z' });
    const second = await service.record(clipA, { decision: 'approved', text: 'mwana wa Mashi', chosenSubmissionId: null, note: 'Elder corrected it' }, 'ADMIN-01');
    expect(second.version).toBe(2);
    expect((await service.history(clipA)).map((row) => row.text)).toEqual(['mwana wa', 'mwana wa Mashi']);
    expect(finals.rows[0]?.text).toBe('mwana wa');
  });

  it('can exclude a clip, but only without text, and approve only with text', async () => {
    const { service } = setup();
    expect(await service.record(clipA, { decision: 'excluded', text: null, chosenSubmissionId: null, note: 'Noise' }, 'ADMIN-01')).toMatchObject({ decision: 'excluded', text: null });
    await expect(service.record(clipA, { decision: 'approved', text: null, chosenSubmissionId: null, note: '' }, 'ADMIN-01')).rejects.toThrow();
    await expect(service.record(clipA, { decision: 'approved', text: '   ', chosenSubmissionId: null, note: '' }, 'ADMIN-01')).rejects.toThrow();
    await expect(service.record(clipA, { decision: 'excluded', text: 'x', chosenSubmissionId: null, note: '' }, 'ADMIN-01')).rejects.toThrow();
  });

  it('refuses a missing clip, an ineligible clip, and takes the next number after a race', async () => {
    const { service, finals } = setup();
    await expect(service.record(id(99), { decision: 'excluded', text: null, chosenSubmissionId: null, note: '' }, 'ADMIN-01')).rejects.toMatchObject({ code: 'clip_not_found' });
    finals.eligible = false;
    await expect(service.record(clipA, { decision: 'excluded', text: null, chosenSubmissionId: null, note: '' }, 'ADMIN-01')).rejects.toMatchObject({ code: 'clip_not_eligible' });
    finals.eligible = true;
    finals.failOnce = Object.assign(new Error('duplicate key'), { code: '23505' });
    expect((await service.record(clipA, { decision: 'approved', text: 'ok', chosenSubmissionId: null, note: '' }, 'ADMIN-01')).version).toBe(1);
    finals.failOnce = new Error('database down');
    await expect(service.record(clipA, { decision: 'approved', text: 'ok', chosenSubmissionId: null, note: '' }, 'ADMIN-01')).rejects.toThrow('database down');
    await expect(service.history(id(99))).rejects.toBeInstanceOf(FinalError);
  });
});

describe('FinalService.manifest', () => {
  it('lists approved, published clips in natural order with audio links, hashes and provenance', async () => {
    const { service, store } = setup();
    await service.record(clipC, { decision: 'approved', text: 'ten', chosenSubmissionId: null, note: '' }, 'ADMIN-01');
    await service.record(clipA, { decision: 'approved', text: 'one', chosenSubmissionId: null, note: 'checked' }, 'ADMIN-01');
    await service.record(clipA, { decision: 'approved', text: 'one again', chosenSubmissionId: null, note: 'second look' }, 'ADMIN-01');
    await service.record(clipB, { decision: 'excluded', text: null, chosenSubmissionId: null, note: 'noise' }, 'ADMIN-01');
    await service.record(clipD, { decision: 'approved', text: 'withdrawn clip', chosenSubmissionId: null, note: '' }, 'ADMIN-01');

    const manifest = await service.manifest(sourceId);
    expect(manifest.clips.map((item) => [item.clipKey, item.transcript, item.finalVersion])).toEqual([['c001', 'one again', 2], ['c010', 'ten', 1]]);
    expect(manifest.clips[0]).toMatchObject({ transcribers: 2, sampleRate: 24000, derivedFrom: 'cleaned', note: 'second look' });
    expect(manifest.clips[0]?.flac).toEqual({ url: `https://storage.example/clips/${clipA}/master.flac`, sha256: 'a'.repeat(64), sizeBytes: 5000, pcmSha256: null });
    expect(store.createDownloadUrl).toHaveBeenCalledWith(`clips/${clipA}/master.flac`, 900);
    expect(manifest.totals).toEqual({ approved: 2, excluded: 1, notExported: 1, durationMs: 6000 });
    expect(JSON.stringify(manifest)).not.toMatch(/p1|p2/);
  });

  it('carries the project, source and the permission statement so the dataset stays traceable', async () => {
    const { service } = setup();
    const manifest = await service.manifest(sourceId);
    expect(manifest.project).toMatchObject({ title: 'Mashi corpus', languageCode: 'shr' });
    expect(manifest.source).toMatchObject({ title: 'A film', originalUrl: 'https://example.org/v' });
    expect(manifest.rights).toMatchObject({ decision: 'approved', rightsHolder: 'Owner', authorizedUses: { publicDistribution: false, transcription: true } });
    expect(manifest.totals).toEqual({ approved: 0, excluded: 0, notExported: 0, durationMs: 0 });
  });

  it('refuses an unknown source', async () => {
    const { service, sources } = setup();
    vi.mocked(sources.getDetail).mockResolvedValue(null);
    await expect(service.manifest(sourceId)).rejects.toMatchObject({ code: 'source_not_found' });
  });
});
