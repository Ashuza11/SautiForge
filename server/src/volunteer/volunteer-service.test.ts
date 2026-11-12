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
  async listContributors(projectId: string) { return [...this.contributors.values()].filter((c) => c.projectId === projectId); }
  async getContributor(id: string) { return this.contributors.get(id) ?? null; }
  decided = new Set<string>();
  private versions(clipId: string) { return this.submissions.filter((s) => s.clipId === clipId && s.kind === 'transcript').length; }
  private open(clipId: string, contributorId: string, max: number) {
    return !this.submissions.some((s) => s.clipId === clipId && s.contributorId === contributorId) && !this.decided.has(clipId) && this.versions(clipId) < max;
  }
  async nextClip(_batch: string, contributorId: string, max: number): Promise<NextClip | null> {
    const open = [clipA, clipB].map((clipId, index) => ({ clipId, index })).filter((item) => this.open(item.clipId, contributorId, max));
    open.sort((x, y) => this.versions(x.clipId) - this.versions(y.clipId) || x.index - y.index);
    const first = open[0];
    return first ? { clipId: first.clipId, position: first.index + 1, durationMs: 3000 } : null;
  }
  async progress(_batch: string, contributorId: string, max: number) {
    const answered = this.submissions.filter((s) => s.contributorId === contributorId).length;
    return { total: answered + [clipA, clipB].filter((clipId) => this.open(clipId, contributorId, max)).length, answered };
  }
  async appendSubmission(s: Submission, max: number) {
    if (this.result === 'unavailable') return 'unavailable' as const;
    if (this.submissions.some((x) => x.clipId === s.clipId && x.contributorId === s.contributorId)) return 'already_answered' as const;
    if (this.decided.has(s.clipId) || this.versions(s.clipId) >= max) return 'unavailable' as const;
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

  it('tells a person when their nickname already exists, and only reuses it when they say it is them', async () => {
    const { service, repo } = setup();
    const first = await service.join(link, 'Yûbaka');
    // capitals, accents and spaces do not make a different nickname
    await expect(service.join(link, ' yubaka ')).rejects.toMatchObject({ code: 'nickname_taken', existing: 'Yûbaka' });
    expect(repo.contributors.size).toBe(1);
    const back = await service.join(link, 'yubaka', true);
    expect(back.contributor.id).toBe(first.contributor.id);
    expect(back.token).toBe(first.token);
    expect(repo.contributors.size).toBe(1);
    expect((await service.join(link, 'Yûbaka2')).contributor.id).not.toBe(first.contributor.id);
    expect(repo.contributors.size).toBe(2);
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

  it('keeps what was heard and the correct form the volunteer suggests as two separate texts', async () => {
    const { service, repo } = setup();
    const one = await join(service, 'Neema');
    const two = await join(service, 'Baraka');
    await service.submit(link, one, clipA, ' afusire ', '  âfusire ');
    await service.submit(link, two, clipA, 'afusire', '   ');
    await service.submit(link, two, clipB, 'afusire');
    const stored = repo.submissions.filter((item) => item.kind === 'transcript').map((item) => [item.text, item.correction]);
    expect(stored).toEqual([['afusire', 'âfusire'], ['afusire', null], ['afusire', null]]);
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

  it('counts only the clips a person can still do, so "of N" never promises work that is closed', async () => {
    const { service, repo } = setup();
    const [one, two, three] = [await join(service, 'One'), await join(service, 'Two'), await join(service, 'Three')];
    await service.submit(link, one, clipA, 'a');
    await service.submit(link, two, clipA, 'b');
    expect((await service.next(link, three)).progress).toEqual({ total: 2, answered: 0 }); // still open to a third version
    repo.decided.add(clipA);
    expect((await service.next(link, three)).progress).toEqual({ total: 1, answered: 0 });
  });

  it('never shows anyone else\'s text, and offers the clip with the fewest versions first', async () => {
    const { service, repo } = setup();
    const [one, two, three] = [await join(service, 'One'), await join(service, 'Two'), await join(service, 'Three')];
    await service.submit(link, one, clipA, 'first text');
    const offerToTwo = await service.next(link, two);
    expect(offerToTwo.clip?.clipId).toBe(clipB); // clip B has no version yet, so it comes first
    expect(JSON.stringify(offerToTwo)).not.toContain('first text');
    await service.submit(link, two, clipA, 'second text');
    await service.submit(link, three, clipA, 'third text'); // a third version is welcome
    expect(repo.submissions.map((s) => s.text)).toEqual(['first text', 'second text', 'third text']);
  });

  it('keeps a clip open for late volunteers until it has five versions or the admin decided it', async () => {
    const { service, repo } = setup();
    const names = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
    const tokens: string[] = [];
    for (const name of names) tokens.push(await join(service, name));
    for (const token of tokens.slice(0, 4)) await service.submit(link, token, clipA, `text ${token.slice(-4)}`);
    expect((await service.next(link, tokens[4]!)).clip?.clipId).toBe(clipB); // B has fewer versions
    await service.skip(link, tokens[4]!, clipB);
    expect((await service.next(link, tokens[4]!)).clip?.clipId).toBe(clipA); // still open: only four versions
    await service.submit(link, tokens[4]!, clipA, 'fifth');
    expect((await service.next(link, tokens[5]!)).clip?.clipId).toBe(clipB);
    await expect(service.submit(link, tokens[5]!, clipA, 'sixth')).rejects.toMatchObject({ code: 'clip_unavailable' }); // five versions: closed
    repo.decided.add(clipB); // the admin chose the best version
    expect((await service.next(link, tokens[5]!)).clip).toBeNull();
    await expect(service.submit(link, tokens[5]!, clipB, 'too late')).rejects.toMatchObject({ code: 'clip_unavailable' });
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
