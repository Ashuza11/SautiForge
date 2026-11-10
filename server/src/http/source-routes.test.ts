import { describe, expect, it } from 'vitest';

import type { Project } from '../../../src/features/projects/domain/project';
import type { ClipService } from '../clips/clip-service';
import type { BatchService } from '../batches/batch-service';
import type { VolunteerService } from '../volunteer/volunteer-service';
import type { SourceMediaService } from '../media/source-media-service';
import type { ProjectRepository } from '../projects/project-repository';
import type { ProjectService } from '../projects/project-service';
import type { ReadinessService } from '../readiness';
import {
  NO_AUTHORIZED_USES,
  type Source,
  type SourceRightsRevision,
} from '../sources/source';
import type { SourceRepository } from '../sources/source-repository';
import { SourceService } from '../sources/source-service';
import { createServerApp } from './app';

const token = 'source-admin-token-that-is-long-enough';
const projectId = '00000000-0000-4000-8000-000000000001';
const sourceId = '00000000-0000-4000-8000-000000000101';
const revisionId = '00000000-0000-4000-8000-000000000201';

const project = {
  id: projectId,
  status: 'active',
} as Project;

class MemorySources implements SourceRepository {
  sources = new Map<string, Source>();
  rights = new Map<string, SourceRightsRevision[]>();
  async list(id: string, includeInactive: boolean) {
    return [...this.sources.values()].filter((source) => source.projectId === id && (includeInactive || !['rejected', 'revoked'].includes(source.status)));
  }
  async getById(id: string) { return this.sources.get(id) ?? null; }
  async getLatestRights(id: string) { return this.rights.get(id)?.at(-1) ?? null; }
  async listRightsHistory(id: string) { return this.rights.get(id) ?? []; }
  async create(source: Source) { this.sources.set(source.id, source); return source; }
  async updateMetadata(source: Source) { this.sources.set(source.id, source); return source; }
  async addRightsRevision(input: Parameters<SourceRepository['addRightsRevision']>[0]) {
    const source = this.sources.get(input.sourceId);
    if (!source) return null;
    const history = this.rights.get(source.id) ?? [];
    const revision: SourceRightsRevision = {
      ...input.draft,
      id: input.id,
      sourceId: source.id,
      revision: history.length + 1,
      createdAt: input.createdAt,
    };
    const updated = { ...source, status: input.status, rightsRevision: revision.revision, updatedAt: input.createdAt };
    this.sources.set(source.id, updated);
    this.rights.set(source.id, [...history, revision]);
    return { source: updated, revision };
  }
}

function sourceApp() {
  const ids = [sourceId, revisionId];
  const projectRepository = { getById: async () => project } as unknown as ProjectRepository;
  const sources = new SourceService(new MemorySources(), projectRepository, {
    idFactory: () => ids.shift()!,
    now: () => new Date('2026-10-25T08:00:00.000Z'),
  });
  return createServerApp({
    projects: {} as ProjectService,
    sources,
    media: {} as SourceMediaService,
    clips: {} as ClipService,
    batches: {} as BatchService,
    volunteer: {} as VolunteerService,
    readiness: {} as ReadinessService,
    adminApiToken: token,
    webOrigin: 'https://annotation.example.org',
  });
}

const metadata = {
  sourceType: 'external_url',
  title: 'Candidate community audio',
  originalUrl: 'https://media.example.org/candidate',
  creator: 'Community creator',
  sourceDate: null,
  durationMs: 90_000,
  externalReference: null,
  languageVerification: 'unverified',
  languageVerifiedBy: null,
  languageVerificationNotes: '',
  speakerIdentification: 'unknown',
  speakerNotes: '',
};

function request(app: ReturnType<typeof sourceApp>, path: string, method = 'GET', body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('source catalogue administration API', () => {
  it('keeps source records behind the administrator boundary', async () => {
    const response = await sourceApp().request(`/v1/admin/projects/${projectId}/sources`);
    expect(response.status).toBe(401);
  });

  it('registers candidates but rejects invalid URL-based metadata', async () => {
    const app = sourceApp();
    const invalid = await request(app, `/v1/admin/projects/${projectId}/sources`, 'POST', { ...metadata, originalUrl: null });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: 'validation_error' });

    const created = await request(app, `/v1/admin/projects/${projectId}/sources`, 'POST', metadata);
    expect(created.status).toBe(201);
    expect((await created.json()).source).toMatchObject({ id: sourceId, status: 'candidate', rightsRevision: 0 });
  });

  it('requires language verification before recording evidence-backed approval', async () => {
    const app = sourceApp();
    await request(app, `/v1/admin/projects/${projectId}/sources`, 'POST', metadata);
    const premature = await request(app, `/v1/admin/sources/${sourceId}/rights`, 'POST', {
      rightsHolder: 'Rights holder',
      license: 'Research permission',
      permissionEvidence: 'Restricted record PERM-01',
      attributionRequirements: null,
      authorizedUses: { ...NO_AUTHORIZED_USES, transcription: true },
      decision: 'approved',
      changedBy: 'ADMIN-01',
      changeReason: 'Permission reviewed.',
    });
    expect(premature.status).toBe(409);
    expect(await premature.json()).toMatchObject({ error: 'language_unverified' });

    const verified = await request(app, `/v1/admin/sources/${sourceId}`, 'PUT', {
      ...metadata,
      languageVerification: 'verified_target',
      languageVerifiedBy: 'REVIEWER-01',
      languageVerificationNotes: 'Verified by reviewers R-01 and R-02.',
    });
    expect((await verified.json()).source.status).toBe('permission_pending');

    const approved = await request(app, `/v1/admin/sources/${sourceId}/rights`, 'POST', {
      rightsHolder: 'Rights holder',
      license: 'Research permission',
      permissionEvidence: 'Restricted record PERM-01',
      attributionRequirements: null,
      authorizedUses: { ...NO_AUTHORIZED_USES, internalProcessing: true, transcription: true },
      decision: 'approved',
      changedBy: 'ADMIN-01',
      changeReason: 'Permission reviewed.',
    });
    expect(approved.status).toBe(201);
    expect(await approved.json()).toMatchObject({
      source: { status: 'approved', rightsRevision: 1 },
      revision: { decision: 'approved', authorizedUses: { publicDistribution: false } },
    });

    const history = await request(app, `/v1/admin/sources/${sourceId}/rights`);
    expect((await history.json()).revisions).toHaveLength(1);
  });
});
