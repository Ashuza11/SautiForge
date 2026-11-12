import { describe, expect, it, vi } from 'vitest';

import type { BatchService } from '../batches/batch-service';
import type { ClipService } from '../clips/clip-service';
import type { ProjectService } from '../projects/project-service';
import { SourceLifecycleError, type SourceService } from '../sources/source-service';
import type { Contributor, NextClip, Submission } from './volunteer';
import type { VolunteerRepository } from './volunteer-repository';
import { VolunteerError, VolunteerService } from './volunteer-service';

const projectId = '00000000-0000-4000-8000-000000000001';
const sourceId = '00000000-0000-4000-8000-000000000101';
const batchId = '00000000-0000-4000-8000-000000000901';
const clipA = '00000000-0000-4000-8000-000000000401';
const clipB = '00000000-0000-4000-8000-000000000402';
const code = 'c'.repeat(24);
const link = `${batchId}.${code}`;

class MemoryVolunteers implements VolunteerRepository {
  contributors = new Map<string, Contributor>();
  submissions: Submission[] = [];
  result: 'recorded' | 'unavailable' = 'recorded';
  async listSubmissionsForSource() { return []; }
  joinsInLastHour = 0;
  async countContributorsSince() { return this.joinsInLastHour; }
  async createContributor(c: Contributor) { this.contributors.set(c.id, c); return c; }
  async getContributor(id: string) { return this.contributors.get(id) ?? null; }
  async nextClip(_batch: string, contributorId: string, required: number): Promise<NextClip | null> {
    for (const [index, clipId] of [clipA, clipB].entries()) {
      const mine = this.submissions.some((s) => s.clipId === clipId && s.contributorId === contributorId);
      const transcripts = this.submissions.filter((s) => s.clipId === clipId && s.kind === 'transcript').length;
      if (!mine && transcripts < required) return { clipId, position: index + 1, durationMs: 3000 };
    }
    return null;
  }
  async progress(_batch: string, contributorId: string, required: number) {
    const answered = this.submissions.filter((s) => s.contributorId === contributorId).length;
    const remaining = [clipA, clipB].filter((clipId) => (
      !this.submissions.some((s) => s.clipId === clipId && s.contributorId === contributorId)
      && this.submissions.filter((s) => s.clipId === clipId && s.kind === 'transcript').length < required
    )).length;
    return { total: answered + remaining, answered };
  }
  async appendSubmission(s: Submission) {
    if (this.result === 'unavailable') return 'unavailable' as const;
    if (this.submissions.some((x) => x.clipId === s.clipId && x.contributorId === s.contributorId)) return 'already_answered' as const;
    this.submissions.push(s);
    return 'recorded' as const;
  }
}

function setup() {
  let counter = 0;
  const repo = new MemoryVolunteers();
  const batches = {
    openFromLink: vi.fn().mockImplementation(async (id: string, token: string) => (
      id === batchId && token === code ? { batch: { id: batchId, projectId, sourceId, title: 'Batch 1', status: 'open' }, clipIds: [clipA, clipB] } : null
    )),
  } as unknown as BatchService;
  const clips = { createListeningUrl: vi.fn().mockImplementation(async (id: string) => `https://storage.example/${id}`) } as unknown as ClipService;
  const projects = { getById: vi.fn().mockResolvedValue({ id: projectId, languageVariety: 'Mashi', targetLanguage: 'Shi' }) } as unknown as ProjectService;
  const sources = { assertUseAuthorized: vi.fn().mockResolvedValue(undefined) } as unknown as SourceService;
  const service = new VolunteerService(repo, batches, clips, projects, sources, {
    linkSecret: 's'.repeat(40),
    idFactory: () => `00000000-0000-4000-8000-${String(++counter + 700).padStart(12, '0')}`,
    now: () => new Date('2026-11-10T10:00:00.000Z'),
  });
  return { service, repo, sources, clips };
}

async function join(service: VolunteerService, name = 'Neema') {
  return (await service.join(link, name)).token;
}

describe('VolunteerService', () => {
  it('shows what the batch is about to someone holding the link, and nothing to anyone else', async () => {
    const { service } = setup();
    expect(await service.info(link)).toEqual({ title: 'Batch 1', clipCount: 2, language: 'Mashi' });
    await expect(service.info(`${batchId}.${'x'.repeat(24)}`)).rejects.toMatchObject({ code: 'link_invalid' });
    await expect(service.info('not-a-link')).rejects.toBeInstanceOf(VolunteerError);
  });

  it('lets a volunteer join with a nickname and signs a personal token', async () => {
    const { service, repo, sources } = setup();
    const joined = await service.join(link, '  Mama   Neema  ');
    expect(joined.contributor.pseudonym).toBe('Mama Neema');
    expect(repo.contributors.get(joined.contributor.id)).toMatchObject({ projectId, pseudonym: 'Mama Neema' });
    expect(joined.token.startsWith(`${joined.contributor.id}.`)).toBe(true);
    expect(sources.assertUseAuthorized).toHaveBeenCalledWith(sourceId, 'volunteerAccess');
    await expect(service.join(link, 'x')).rejects.toThrow();
  });

  it('stops new volunteers from joining when too many joined within the hour', async () => {
    const { service, repo } = setup();
    repo.joinsInLastHour = 199;
    await expect(service.join(link, 'Neema')).resolves.toBeDefined();
    repo.joinsInLastHour = 200;
    await expect(service.join(link, 'Baraka')).rejects.toMatchObject({ code: 'too_many_joins' });
    expect(repo.contributors.size).toBe(1);
  });

  it('refuses a forged, altered or foreign token', async () => {
    const { service } = setup();
    const token = await join(service);
    const [id] = token.split('.');
    await expect(service.next(link, `${id}.${'z'.repeat(24)}`)).rejects.toMatchObject({ code: 'contributor_invalid' });
    await expect(service.next(link, `${'0'.repeat(8)}-0000-4000-8000-000000000000.${'z'.repeat(24)}`)).rejects.toMatchObject({ code: 'contributor_invalid' });
    await expect(service.next(`${batchId}.${'x'.repeat(24)}`, token)).rejects.toMatchObject({ code: 'link_invalid' });
  });

  it('lets anyone with the batch link hear one of its clips, and nothing else', async () => {
    const { service, clips } = setup();
    expect(await service.listen(link, clipB)).toEqual({ position: 2, clipCount: 2, audioUrl: `https://storage.example/${clipB}` });
    expect(clips.createListeningUrl).toHaveBeenCalledWith(clipB);
    await expect(service.listen(link, '00000000-0000-4000-8000-0000000009ff')).rejects.toMatchObject({ code: 'clip_unavailable' });
    await expect(service.listen(`${batchId}.${'x'.repeat(24)}`, clipA)).rejects.toMatchObject({ code: 'link_invalid' });
  });

  it('offers one clip at a time with a signed audio link and the person\'s own progress', async () => {
    const { service, clips } = setup();
    const token = await join(service);
    const first = await service.next(link, token);
    expect(first).toEqual({ clip: { clipId: clipA, position: 1, durationMs: 3000, audioUrl: `https://storage.example/${clipA}` }, progress: { total: 2, answered: 0 } });
    expect(clips.createListeningUrl).toHaveBeenCalledWith(clipA);
    expect(await service.submit(link, token, clipA, '  mwana   wa  Mashi ')).toBe('recorded');
    const second = await service.next(link, token);
    expect(second.clip?.clipId).toBe(clipB);
    expect(second.progress.answered).toBe(1);
    await service.skip(link, token, clipB);
    expect(await service.next(link, token)).toEqual({ clip: null, progress: { total: 2, answered: 2 } });
  });

  it('counts only the clips a person can still do, so "of N" never promises work that is full', async () => {
    const { service } = setup();
    const [one, two, three] = [await join(service, 'One'), await join(service, 'Two'), await join(service, 'Three')];
    await service.submit(link, one, clipA, 'a');
    await service.submit(link, two, clipA, 'b');
    expect((await service.next(link, three)).progress).toEqual({ total: 1, answered: 0 });
  });

  it('never shows anyone else\'s text, and stops offering a clip after two different people wrote it', async () => {
    const { service, repo } = setup();
    const [one, two, three] = [await join(service, 'One'), await join(service, 'Two'), await join(service, 'Three')];
    await service.submit(link, one, clipA, 'first text');
    const offerToTwo = await service.next(link, two);
    expect(offerToTwo.clip?.clipId).toBe(clipA);
    expect(JSON.stringify(offerToTwo)).not.toContain('first text');
    await service.submit(link, two, clipA, 'second text');
    expect((await service.next(link, three)).clip?.clipId).toBe(clipB);
    expect(repo.submissions.map((s) => s.text)).toEqual(['first text', 'second text']);
  });

  it('keeps skips from counting as transcripts, so skipped clips still reach other people', async () => {
    const { service } = setup();
    const [one, two] = [await join(service, 'One'), await join(service, 'Two')];
    await service.skip(link, one, clipA);
    expect((await service.next(link, two)).clip?.clipId).toBe(clipA);
  });

  it('answers twice from a slow network without creating a second record', async () => {
    const { service, repo } = setup();
    const token = await join(service);
    expect(await service.submit(link, token, clipA, 'hello')).toBe('recorded');
    expect(await service.submit(link, token, clipA, 'hello again')).toBe('already_answered');
    expect(repo.submissions).toHaveLength(1);
    expect(repo.submissions[0]?.text).toBe('hello');
  });

  it('refuses clips outside the batch, unavailable clips, empty text and revoked permission', async () => {
    const { service, repo, sources } = setup();
    const token = await join(service);
    await expect(service.submit(link, token, '00000000-0000-4000-8000-0000000fffff', 'x')).rejects.toMatchObject({ code: 'clip_unavailable' });
    repo.result = 'unavailable';
    await expect(service.submit(link, token, clipA, 'text')).rejects.toMatchObject({ code: 'clip_unavailable' });
    repo.result = 'recorded';
    await expect(service.submit(link, token, clipA, '   ')).rejects.toThrow();
    vi.mocked(sources.assertUseAuthorized).mockRejectedValue(new SourceLifecycleError('use_not_authorized', 'no'));
    await expect(service.next(link, token)).rejects.toMatchObject({ code: 'use_not_authorized' });
  });
});
