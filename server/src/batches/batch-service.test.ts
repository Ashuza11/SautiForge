import { describe, expect, it, vi } from 'vitest';

import type { Source } from '../sources/source';
import { SourceLifecycleError, type SourceService } from '../sources/source-service';
import type { Batch, BatchWithClips } from './batch';
import type { BatchRepository } from './batch-repository';
import { BatchLifecycleError, BatchService } from './batch-service';

const projectId = '00000000-0000-4000-8000-000000000001';
const sourceId = '00000000-0000-4000-8000-000000000101';
const clip = (n: number) => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, '0')}`;
const secret = 'x'.repeat(40);

class MemoryBatches implements BatchRepository {
  rows = new Map<string, BatchWithClips>();
  eligible = true;
  async listForSource() { return [...this.rows.values()]; }
  async getById(id: string) { return this.rows.get(id) ?? null; }
  async countForSource() { return this.rows.size; }
  async createWhenEligible(batch: Batch, clipIds: string[]) {
    if (!this.eligible) return null;
    const saved = { batch, clipIds };
    this.rows.set(batch.id, saved);
    return saved;
  }
  async close(id: string, now: string) {
    const found = this.rows.get(id);
    if (!found || found.batch.status === 'closed') return false;
    this.rows.set(id, { ...found, batch: { ...found.batch, status: 'closed', closedAt: now } });
    return true;
  }
}

function setup() {
  let counter = 0;
  const repo = new MemoryBatches();
  const sources = {
    getDetail: vi.fn().mockResolvedValue({ source: { id: sourceId, projectId } as Source, latestRights: { revision: 1 } }),
    assertUseAuthorized: vi.fn().mockResolvedValue(undefined),
  } as unknown as SourceService;
  const service = new BatchService(repo, sources, {
    linkSecret: secret,
    idFactory: () => `00000000-0000-4000-8000-${String(++counter + 900).padStart(12, '0')}`,
    now: () => new Date('2026-11-10T10:00:00.000Z'),
  });
  return { service, repo, sources };
}

describe('BatchService', () => {
  it('creates an open batch with a numbered title and a link code', async () => {
    const { service, sources } = setup();
    const first = await service.create(sourceId, { title: null, clipIds: [clip(1), clip(2)] }, 'ADMIN-01');
    expect(first.batch).toMatchObject({ title: 'Batch 1', status: 'open', projectId, sourceId, createdBy: 'ADMIN-01' });
    expect(first.clipIds).toEqual([clip(1), clip(2)]);
    expect(first.token).toHaveLength(24);
    expect(sources.assertUseAuthorized).toHaveBeenCalledWith(sourceId, 'volunteerAccess');
    expect(sources.assertUseAuthorized).toHaveBeenCalledWith(sourceId, 'transcription');
    expect((await service.create(sourceId, { title: 'Market words', clipIds: [clip(3)] }, 'ADMIN-01')).batch.title).toBe('Market words');
    expect((await service.create(sourceId, { title: null, clipIds: [clip(4)] }, 'ADMIN-01')).batch.title).toBe('Batch 3');
  });

  it('refuses a missing source, unauthorized use, and clips that are not available', async () => {
    const a = setup();
    vi.mocked(a.sources.getDetail).mockResolvedValue(null);
    await expect(a.service.create(sourceId, { title: null, clipIds: [clip(1)] }, 'ADMIN-01')).rejects.toMatchObject({ code: 'source_not_found' });
    const b = setup();
    vi.mocked(b.sources.assertUseAuthorized).mockRejectedValue(new SourceLifecycleError('use_not_authorized', 'no'));
    await expect(b.service.create(sourceId, { title: null, clipIds: [clip(1)] }, 'ADMIN-01')).rejects.toMatchObject({ code: 'use_not_authorized' });
    expect(b.repo.rows.size).toBe(0);
    const c = setup();
    c.repo.eligible = false;
    await expect(c.service.create(sourceId, { title: null, clipIds: [clip(1)] }, 'ADMIN-01')).rejects.toMatchObject({ code: 'clips_unavailable' });
  });

  it('rejects empty, oversized and duplicated clip lists', async () => {
    const { service } = setup();
    await expect(service.create(sourceId, { title: null, clipIds: [] }, 'ADMIN-01')).rejects.toThrow();
    await expect(service.create(sourceId, { title: null, clipIds: Array.from({ length: 11 }, (_, i) => clip(i)) }, 'ADMIN-01')).rejects.toThrow();
    await expect(service.create(sourceId, { title: null, clipIds: [clip(1), clip(1)] }, 'ADMIN-01')).rejects.toThrow();
  });

  it('signs links so they cannot be guessed or moved to another batch', async () => {
    const { service } = setup();
    const a = await service.create(sourceId, { title: null, clipIds: [clip(1)] }, 'ADMIN-01');
    const b = await service.create(sourceId, { title: null, clipIds: [clip(2)] }, 'ADMIN-01');
    expect(a.token).toBe(service.tokenFor(a.batch.id));
    expect(a.token).not.toBe(b.token);
    expect(service.tokenMatches(a.batch.id, a.token)).toBe(true);
    expect(service.tokenMatches(b.batch.id, a.token)).toBe(false);
    expect(service.tokenMatches(a.batch.id, 'short')).toBe(false);
    expect(new BatchService(new MemoryBatches(), {} as SourceService, { linkSecret: 'y'.repeat(40) }).tokenFor(a.batch.id)).not.toBe(a.token);
    expect(() => new BatchService(new MemoryBatches(), {} as SourceService, { linkSecret: 'short' })).toThrow('32');
  });

  it('opens a batch from its link only while it is open', async () => {
    const { service } = setup();
    const { batch, token } = await service.create(sourceId, { title: null, clipIds: [clip(1)] }, 'ADMIN-01');
    expect(await service.openFromLink(batch.id, token)).toMatchObject({ batch: { id: batch.id } });
    expect(await service.openFromLink(batch.id, 'wrong-code-wrong-code-xx')).toBeNull();
    expect((await service.close(batch.id)).batch.status).toBe('closed');
    expect((await service.close(batch.id)).batch.status).toBe('closed');
    expect(await service.openFromLink(batch.id, token)).toBeNull();
    await expect(service.close('00000000-0000-4000-8000-00000000ffff')).rejects.toBeInstanceOf(BatchLifecycleError);
  });
});
