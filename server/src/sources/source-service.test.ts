import { describe, expect, it } from 'vitest';

import type { Project } from '../../../src/features/projects/domain/project';
import type { ProjectRepository } from '../projects/project-repository';
import {
  NO_AUTHORIZED_USES,
  type Source,
  type SourceMetadataDraft,
  type SourceRightsRevision,
} from './source';
import type { SourceRepository } from './source-repository';
import { SourceLifecycleError, SourceService } from './source-service';

const projectId = '00000000-0000-4000-8000-000000000001';
const sourceId = '00000000-0000-4000-8000-000000000101';
const revisionIds = [
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000202',
  '00000000-0000-4000-8000-000000000203',
];

const project: Project = {
  id: projectId,
  title: 'Reusable language project',
  description: '',
  targetLanguage: 'Example language',
  languageCode: 'exa',
  languageVariety: 'Community variety',
  researchDomain: 'General speech',
  collectionLocation: 'DRC',
  protocolVersion: '2.0',
  annotationProfile: 'verbatim_transcription',
  status: 'active',
  createdAt: '2026-10-25T08:00:00.000Z',
  updatedAt: '2026-10-25T08:00:00.000Z',
};

const candidateDraft: SourceMetadataDraft = {
  sourceType: 'external_url',
  title: 'Discovered language recording',
  originalUrl: 'https://media.example.org/recording',
  creator: 'Example creator',
  sourceDate: null,
  durationMs: null,
  externalReference: null,
  languageVerification: 'unverified',
  languageVerifiedBy: null,
  languageVerificationNotes: '',
  speakerIdentification: 'not_assessed',
  speakerNotes: '',
};

class MemorySourceRepository implements SourceRepository {
  sources = new Map<string, Source>();
  rights = new Map<string, SourceRightsRevision[]>();
  async list(id: string, includeInactive: boolean) {
    return [...this.sources.values()].filter((source) => source.projectId === id && (includeInactive || !['rejected', 'revoked'].includes(source.status)));
  }
  async getById(id: string) { return this.sources.get(id) ?? null; }
  async getLatestRights(id: string) { return this.rights.get(id)?.at(-1) ?? null; }
  async listRightsHistory(id: string) { return this.rights.get(id) ?? []; }
  async create(source: Source) { this.sources.set(source.id, source); return source; }
  async updateMetadata(source: Source): Promise<Source | null> { this.sources.set(source.id, source); return source; }
  async addRightsRevision(input: Parameters<SourceRepository['addRightsRevision']>[0]) {
    const source = this.sources.get(input.sourceId);
    if (!source) return null;
    const history = this.rights.get(input.sourceId) ?? [];
    const revision: SourceRightsRevision = {
      ...input.draft,
      id: input.id,
      sourceId: input.sourceId,
      revision: history.length + 1,
      createdAt: input.createdAt,
    };
    const updated: Source = {
      ...source,
      status: input.status,
      rightsRevision: revision.revision,
      updatedAt: input.createdAt,
    };
    this.sources.set(source.id, updated);
    this.rights.set(source.id, [...history, revision]);
    return { source: updated, revision };
  }
}

function projectRepository(value: Project | null = project): ProjectRepository {
  return {
    getById: async () => value,
  } as unknown as ProjectRepository;
}

function service(repository = new MemorySourceRepository()) {
  const ids = [sourceId, ...revisionIds];
  let minute = 0;
  return {
    repository,
    service: new SourceService(repository, projectRepository(), {
      idFactory: () => ids.shift()!,
      now: () => new Date(`2026-10-25T08:${String(minute++).padStart(2, '0')}:00.000Z`),
    }),
  };
}

const approvedRights = {
  rightsHolder: 'Community media group',
  license: 'Research permission agreement',
  permissionEvidence: 'Restricted evidence reference PERM-01',
  attributionRequirements: 'Credit the community media group.',
  authorizedUses: {
    ...NO_AUTHORIZED_USES,
    internalProcessing: true,
    volunteerAccess: true,
    transcription: true,
  },
  decision: 'approved' as const,
  changedBy: 'ADMIN-01',
  changeReason: 'Written permission verified.',
};

describe('SourceService rights lifecycle', () => {
  it('creates only a candidate under an active project', async () => {
    const { service: sourceService } = service();
    await expect(sourceService.create(projectId, candidateDraft)).resolves.toMatchObject({
      id: sourceId,
      projectId,
      status: 'candidate',
      rightsRevision: 0,
    });

    const unavailable = new SourceService(new MemorySourceRepository(), projectRepository({ ...project, status: 'archived' }));
    await expect(unavailable.create(projectId, candidateDraft)).rejects.toMatchObject({ code: 'project_unavailable' });
  });

  it('blocks approval until the target language is verified', async () => {
    const { service: sourceService } = service();
    await sourceService.create(projectId, candidateDraft);
    await expect(sourceService.addRightsRevision(sourceId, approvedRights)).rejects.toMatchObject({
      code: 'language_unverified',
    });
  });

  it('moves verified sources through permission pending to use-specific approval', async () => {
    const { service: sourceService } = service();
    await sourceService.create(projectId, candidateDraft);
    await expect(sourceService.updateMetadata(sourceId, {
      ...candidateDraft,
      languageVerification: 'verified_target',
      languageVerifiedBy: 'REVIEWER-01',
      languageVerificationNotes: 'Verified by project reviewers R-01 and R-02.',
    })).resolves.toMatchObject({ status: 'permission_pending' });

    const result = await sourceService.addRightsRevision(sourceId, approvedRights);
    expect(result).toMatchObject({
      source: { status: 'approved', rightsRevision: 1 },
      revision: { revision: 1, decision: 'approved' },
    });
    await expect(sourceService.assertUseAuthorized(sourceId, 'transcription')).resolves.toBeUndefined();
    await expect(sourceService.assertUseAuthorized(sourceId, 'publicDistribution')).rejects.toMatchObject({ code: 'use_not_authorized' });
  });

  it('preserves approval history and blocks all uses after revocation', async () => {
    const { service: sourceService } = service();
    await sourceService.create(projectId, { ...candidateDraft, languageVerification: 'verified_target', languageVerifiedBy: 'REVIEWER-01' });
    await sourceService.addRightsRevision(sourceId, approvedRights);
    const revoked = await sourceService.addRightsRevision(sourceId, {
      rightsHolder: 'Community media group',
      license: null,
      permissionEvidence: 'Withdrawal record PERM-02',
      attributionRequirements: null,
      authorizedUses: NO_AUTHORIZED_USES,
      decision: 'revoked',
      changedBy: 'ADMIN-02',
      changeReason: 'Rights holder withdrew permission.',
    });

    expect(revoked).toMatchObject({ source: { status: 'revoked', rightsRevision: 2 } });
    await expect(sourceService.rightsHistory(sourceId)).resolves.toHaveLength(2);
    await expect(sourceService.assertUseAuthorized(sourceId, 'internalProcessing')).rejects.toBeInstanceOf(SourceLifecycleError);
  });

  it('blocks otherwise approved source use when its project is archived', async () => {
    const repository = new MemorySourceRepository();
    const activeService = service(repository).service;
    await activeService.create(projectId, {
      ...candidateDraft,
      languageVerification: 'verified_target',
      languageVerifiedBy: 'REVIEWER-01',
    });
    await activeService.addRightsRevision(sourceId, approvedRights);

    const archivedService = new SourceService(repository, projectRepository({ ...project, status: 'archived' }));
    await expect(archivedService.assertUseAuthorized(sourceId, 'internalProcessing')).rejects.toMatchObject({
      code: 'project_unavailable',
    });
  });

  it('does not permit a revocation without a current approval', async () => {
    const { service: sourceService } = service();
    await sourceService.create(projectId, { ...candidateDraft, languageVerification: 'verified_target', languageVerifiedBy: 'REVIEWER-01' });
    await expect(sourceService.addRightsRevision(sourceId, {
      rightsHolder: null,
      license: null,
      permissionEvidence: 'No permission granted.',
      attributionRequirements: null,
      authorizedUses: NO_AUTHORIZED_USES,
      decision: 'revoked',
      changedBy: 'ADMIN-01',
      changeReason: 'Invalid attempted revocation.',
    })).rejects.toMatchObject({ code: 'invalid_revocation' });
  });

  it('reports recoverable conflicts instead of overwriting concurrent review changes', async () => {
    const metadataRepository = new MemorySourceRepository();
    const metadataSetup = service(metadataRepository);
    await metadataSetup.service.create(projectId, candidateDraft);
    metadataRepository.updateMetadata = async () => null;
    await expect(metadataSetup.service.updateMetadata(sourceId, candidateDraft)).rejects.toMatchObject({ code: 'source_changed' });

    const rightsRepository = new MemorySourceRepository();
    const rightsSetup = service(rightsRepository);
    await rightsSetup.service.create(projectId, {
      ...candidateDraft,
      languageVerification: 'verified_target',
      languageVerifiedBy: 'REVIEWER-01',
    });
    rightsRepository.addRightsRevision = async () => null;
    await expect(rightsSetup.service.addRightsRevision(sourceId, approvedRights)).rejects.toMatchObject({ code: 'source_changed' });
  });
});
