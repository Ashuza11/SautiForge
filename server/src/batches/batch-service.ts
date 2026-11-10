import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { SourceService } from '../sources/source-service';
import { batchDraftSchema, batchSchema, type BatchDraft, type BatchWithClips } from './batch';
import type { BatchRepository } from './batch-repository';

export class BatchLifecycleError extends Error {
  constructor(
    readonly code: 'source_not_found' | 'batch_not_found' | 'clips_unavailable' | 'source_changed',
    message: string,
  ) {
    super(message);
  }
}

export type BatchWithLink = BatchWithClips & { token: string };

export type BatchServiceOptions = {
  /** Secret for signing batch links. Links cannot be forged without it, and nothing about them is stored. */
  linkSecret: string;
  idFactory?: () => string;
  now?: () => Date;
};

export class BatchService {
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly linkSecret: string;

  constructor(
    private readonly batches: BatchRepository,
    private readonly sources: SourceService,
    options: BatchServiceOptions,
  ) {
    if (options.linkSecret.length < 32) throw new Error('The batch link secret must be at least 32 characters.');
    this.linkSecret = options.linkSecret;
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  /** The code at the end of a batch link. It is derived from the batch id, so it needs no storage. */
  tokenFor(batchId: string): string {
    return createHmac('sha256', this.linkSecret).update(`batch-link:${batchId}`).digest('base64url').slice(0, 24);
  }

  tokenMatches(batchId: string, candidate: string): boolean {
    const expected = Buffer.from(this.tokenFor(batchId));
    const given = Buffer.from(candidate);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async listForSource(sourceId: string): Promise<BatchWithLink[]> {
    return (await this.batches.listForSource(sourceId)).map((item) => this.withLink(item));
  }

  async getForAdmin(batchId: string): Promise<BatchWithLink> {
    const found = await this.batches.getById(batchId);
    if (!found) throw new BatchLifecycleError('batch_not_found', 'The batch does not exist.');
    return this.withLink(found);
  }

  /** Finds a batch from a shared link; null for a wrong code or a closed batch. */
  async openFromLink(batchId: string, token: string): Promise<BatchWithClips | null> {
    if (!this.tokenMatches(batchId, token)) return null;
    const found = await this.batches.getById(batchId);
    return found && found.batch.status === 'open' ? found : null;
  }

  async create(sourceId: string, input: BatchDraft, createdBy: string): Promise<BatchWithLink> {
    const detail = await this.sources.getDetail(sourceId);
    if (!detail) throw new BatchLifecycleError('source_not_found', 'The source does not exist.');
    await this.sources.assertUseAuthorized(sourceId, 'volunteerAccess');
    await this.sources.assertUseAuthorized(sourceId, 'transcription');

    const draft = batchDraftSchema.parse(input);
    const title = draft.title ?? `Batch ${(await this.batches.countForSource(sourceId)) + 1}`;
    const batch = batchSchema.parse({
      id: this.idFactory(),
      projectId: detail.source.projectId,
      sourceId,
      title,
      status: 'open',
      createdBy,
      createdAt: this.now().toISOString(),
      closedAt: null,
    });
    const created = await this.batches.createWhenEligible(batch, draft.clipIds);
    if (!created) {
      throw new BatchLifecycleError('clips_unavailable', 'Some of these clips are no longer available. They may already be in another batch. Reload and choose again.');
    }
    return this.withLink(created);
  }

  async close(batchId: string): Promise<BatchWithLink> {
    const current = await this.batches.getById(batchId);
    if (!current) throw new BatchLifecycleError('batch_not_found', 'The batch does not exist.');
    if (current.batch.status === 'open') await this.batches.close(batchId, this.now().toISOString());
    return this.getForAdmin(batchId);
  }

  private withLink(item: BatchWithClips): BatchWithLink {
    return { ...item, token: this.tokenFor(item.batch.id) };
  }
}
