import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { BatchService } from '../batches/batch-service';
import type { ClipService } from '../clips/clip-service';
import type { ProjectService } from '../projects/project-service';
import type { SourceService } from '../sources/source-service';
import { REQUIRED_TRANSCRIPTS, pseudonymSchema, transcriptTextSchema, type Contributor } from './volunteer';
import type { BatchProgress, VolunteerRepository } from './volunteer-repository';

export class VolunteerError extends Error {
  constructor(
    readonly code: 'link_invalid' | 'contributor_invalid' | 'clip_unavailable' | 'too_many_joins',
    message: string,
  ) {
    super(message);
  }
}

/** New volunteers allowed per project per hour. Generous for a community launch, small enough to stop abuse. */
export const MAX_JOINS_PER_HOUR = 200;

export type VolunteerServiceOptions = { linkSecret: string; idFactory?: () => string; now?: () => Date; maxJoinsPerHour?: number };

export type BatchInfo = { title: string; clipCount: number; language: string };
export type ClipOffer = { clipId: string; position: number; durationMs: number; audioUrl: string };
export type NextResult = { clip: ClipOffer | null; progress: BatchProgress };

/**
 * Everything a volunteer can do. A volunteer holds a batch link and a personal token, and can only
 * ever receive audio and their own progress, never another person's text.
 */
export class VolunteerService {
  private readonly idFactory: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly repo: VolunteerRepository,
    private readonly batches: BatchService,
    private readonly clips: ClipService,
    private readonly projects: ProjectService,
    private readonly sources: SourceService,
    private readonly options: VolunteerServiceOptions,
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  contributorToken(contributorId: string): string {
    const code = createHmac('sha256', this.options.linkSecret).update(`contributor:${contributorId}`).digest('base64url').slice(0, 24);
    return `${contributorId}.${code}`;
  }

  private contributorIdFrom(token: string): string | null {
    const [id, code] = token.split('.');
    if (!id || !code) return null;
    const expected = Buffer.from(this.contributorToken(id).split('.')[1] ?? '');
    const given = Buffer.from(code);
    return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
  }

  async info(link: string): Promise<BatchInfo> {
    const found = await this.openBatch(link);
    const project = await this.projects.getById(found.batch.projectId);
    return { title: found.batch.title, clipCount: found.clipIds.length, language: project?.languageVariety || project?.targetLanguage || '' };
  }

  async join(link: string, pseudonym: string): Promise<{ contributor: { id: string; pseudonym: string }; token: string }> {
    const found = await this.openBatch(link);
    await this.assertAllowed(found.batch.sourceId);
    const since = new Date(this.now().getTime() - 60 * 60 * 1000).toISOString();
    if (await this.repo.countContributorsSince(found.batch.projectId, since) >= (this.options.maxJoinsPerHour ?? MAX_JOINS_PER_HOUR)) {
      throw new VolunteerError('too_many_joins', 'Many people are joining right now. Please try again in a few minutes.');
    }
    const contributor: Contributor = {
      id: this.idFactory(),
      projectId: found.batch.projectId,
      pseudonym: pseudonymSchema.parse(pseudonym),
      createdAt: this.now().toISOString(),
    };
    await this.repo.createContributor(contributor);
    return { contributor: { id: contributor.id, pseudonym: contributor.pseudonym }, token: this.contributorToken(contributor.id) };
  }

  async next(link: string, token: string): Promise<NextResult> {
    const { found, contributor } = await this.authenticate(link, token);
    await this.assertAllowed(found.batch.sourceId);
    const progress = await this.repo.progress(found.batch.id, contributor.id, REQUIRED_TRANSCRIPTS);
    const clip = await this.repo.nextClip(found.batch.id, contributor.id, REQUIRED_TRANSCRIPTS);
    if (!clip) return { clip: null, progress };
    return { clip: { ...clip, audioUrl: await this.clips.createListeningUrl(clip.clipId) }, progress };
  }

  async submit(link: string, token: string, clipId: string, text: string): Promise<'recorded' | 'already_answered'> {
    return this.answer(link, token, clipId, 'transcript', transcriptTextSchema.parse(text));
  }

  async skip(link: string, token: string, clipId: string): Promise<'recorded' | 'already_answered'> {
    return this.answer(link, token, clipId, 'skip', null);
  }

  private async answer(link: string, token: string, clipId: string, kind: 'transcript' | 'skip', text: string | null) {
    const { found, contributor } = await this.authenticate(link, token);
    if (!found.clipIds.includes(clipId)) throw new VolunteerError('clip_unavailable', 'This clip is not part of the batch.');
    const result = await this.repo.appendSubmission({
      id: this.idFactory(),
      clipId,
      batchId: found.batch.id,
      contributorId: contributor.id,
      kind,
      text,
      createdAt: this.now().toISOString(),
    });
    if (result === 'unavailable') throw new VolunteerError('clip_unavailable', 'This clip is no longer available.');
    return result;
  }

  private async openBatch(link: string) {
    const [batchId, code] = link.split('.');
    const found = batchId && code ? await this.batches.openFromLink(batchId, code) : null;
    if (!found) throw new VolunteerError('link_invalid', 'This link is not valid, or the batch has closed.');
    return found;
  }

  private async authenticate(link: string, token: string) {
    const found = await this.openBatch(link);
    const id = this.contributorIdFrom(token);
    const contributor = id ? await this.repo.getContributor(id) : null;
    if (!contributor || contributor.projectId !== found.batch.projectId) {
      throw new VolunteerError('contributor_invalid', 'Please enter your nickname again.');
    }
    return { found, contributor };
  }

  private async assertAllowed(sourceId: string): Promise<void> {
    await this.sources.assertUseAuthorized(sourceId, 'volunteerAccess');
    await this.sources.assertUseAuthorized(sourceId, 'transcription');
  }
}
