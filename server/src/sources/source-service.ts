import { randomUUID } from 'node:crypto';

import type { ProjectRepository } from '../projects/project-repository';
import type { SourceRepository } from './source-repository';
import {
  sourceMetadataDraftSchema,
  sourceRightsDraftSchema,
  sourceSchema,
  type AuthorizedUse,
  type Source,
  type SourceMetadataDraft,
  type SourceRightsDraft,
  type SourceRightsRevision,
  type SourceStatus,
} from './source';

export class SourceLifecycleError extends Error {
  constructor(
    readonly code: 'project_unavailable' | 'language_unverified' | 'invalid_revocation' | 'source_changed' | 'use_not_authorized',
    message: string,
  ) {
    super(message);
  }
}

export type SourceServiceOptions = {
  idFactory?: () => string;
  now?: () => Date;
};

export class SourceService {
  private readonly idFactory: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly sources: SourceRepository,
    private readonly projects: ProjectRepository,
    options: SourceServiceOptions = {},
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  list(projectId: string, includeInactive = false): Promise<Source[]> {
    return this.sources.list(projectId, includeInactive);
  }

  async getDetail(id: string): Promise<{ source: Source; latestRights: SourceRightsRevision | null } | null> {
    const source = await this.sources.getById(id);
    if (!source) return null;
    return { source, latestRights: await this.sources.getLatestRights(id) };
  }

  rightsHistory(id: string): Promise<SourceRightsRevision[]> {
    return this.sources.listRightsHistory(id);
  }

  async create(projectId: string, input: SourceMetadataDraft): Promise<Source> {
    const project = await this.projects.getById(projectId);
    if (!project || project.status !== 'active') {
      throw new SourceLifecycleError('project_unavailable', 'Sources require an active project.');
    }
    const draft = sourceMetadataDraftSchema.parse(input);
    const timestamp = this.now().toISOString();
    return this.sources.create(sourceSchema.parse({
      ...draft,
      id: this.idFactory(),
      projectId,
      status: 'candidate',
      rightsRevision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
  }

  async updateMetadata(id: string, input: SourceMetadataDraft): Promise<Source | null> {
    const current = await this.sources.getById(id);
    if (!current) return null;
    const draft = sourceMetadataDraftSchema.parse(input);
    const latestRights = await this.sources.getLatestRights(id);
    const status = deriveStatus(draft.languageVerification, latestRights, current.status === 'candidate');
    const updated = await this.sources.updateMetadata(sourceSchema.parse({
      ...current,
      ...draft,
      status,
      updatedAt: this.now().toISOString(),
    }));
    if (!updated && await this.sources.getById(id)) {
      throw new SourceLifecycleError('source_changed', 'The source changed during review. Reload it before saving again.');
    }
    return updated;
  }

  async addRightsRevision(id: string, input: SourceRightsDraft) {
    const source = await this.sources.getById(id);
    if (!source) return null;
    const draft = sourceRightsDraftSchema.parse(input);
    const latest = await this.sources.getLatestRights(id);
    if (draft.decision === 'approved' && !isTargetLanguageVerified(source)) {
      throw new SourceLifecycleError('language_unverified', 'Verify the source language before approving any use.');
    }
    if (draft.decision === 'revoked' && latest?.decision !== 'approved') {
      throw new SourceLifecycleError('invalid_revocation', 'Only currently approved rights can be revoked.');
    }
    const status = deriveStatus(source.languageVerification, { decision: draft.decision }, false);
    const result = await this.sources.addRightsRevision({
      id: this.idFactory(),
      sourceId: id,
      status,
      draft,
      createdAt: this.now().toISOString(),
    });
    if (!result && await this.sources.getById(id)) {
      throw new SourceLifecycleError('source_changed', 'The source changed during rights review. Reload it before saving again.');
    }
    return result;
  }

  async assertUseAuthorized(id: string, use: AuthorizedUse): Promise<void> {
    const detail = await this.getDetail(id);
    if (!detail || detail.source.status !== 'approved' || detail.latestRights?.decision !== 'approved' || !detail.latestRights.authorizedUses[use]) {
      throw new SourceLifecycleError('use_not_authorized', `The source is not authorized for ${use}.`);
    }
    const project = await this.projects.getById(detail.source.projectId);
    if (!project || project.status !== 'active') {
      throw new SourceLifecycleError('project_unavailable', 'Source use requires an active project.');
    }
  }
}

function isTargetLanguageVerified(source: Pick<Source, 'languageVerification'>): boolean {
  return source.languageVerification === 'verified_target' || source.languageVerification === 'mixed_target';
}

function deriveStatus(
  languageVerification: SourceMetadataDraft['languageVerification'],
  rights: Pick<SourceRightsRevision, 'decision'> | null,
  preserveCandidate: boolean,
): SourceStatus {
  if (rights?.decision === 'revoked') return 'revoked';
  if (rights?.decision === 'rejected' || languageVerification === 'wrong_language') return 'rejected';
  if (languageVerification === 'unverified') return preserveCandidate ? 'candidate' : 'language_unverified';
  if (rights?.decision === 'approved') return 'approved';
  return 'permission_pending';
}
