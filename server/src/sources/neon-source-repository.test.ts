import { describe, expect, it, vi } from 'vitest';

import type { SqlExecutor } from '../database/neon';
import { NeonSourceRepository } from './neon-source-repository';
import type { Source } from './source';

const source: Source = {
  id: '00000000-0000-4000-8000-000000000101',
  projectId: '00000000-0000-4000-8000-000000000001',
  sourceType: 'youtube_reference',
  title: 'Candidate film',
  originalUrl: 'https://www.youtube.com/watch?v=example',
  creator: 'Example creator',
  sourceDate: '2026-10-01',
  durationMs: 120_000,
  externalReference: null,
  languageVerification: 'verified_target',
  languageVerifiedBy: 'REVIEWER-01',
  languageVerificationNotes: 'Reviewed by two speakers.',
  speakerIdentification: 'unknown',
  speakerNotes: 'Publisher is not assumed to be the speaker.',
  status: 'permission_pending',
  rightsRevision: 0,
  createdAt: '2026-10-25T08:00:00.000Z',
  updatedAt: '2026-10-25T08:00:00.000Z',
};

const sourceRow = {
  id: source.id,
  project_id: source.projectId,
  source_type: source.sourceType,
  title: source.title,
  original_url: source.originalUrl,
  creator: source.creator,
  source_date: source.sourceDate,
  duration_ms: String(source.durationMs),
  external_reference: source.externalReference,
  language_verification: source.languageVerification,
  language_verified_by: source.languageVerifiedBy,
  language_verification_notes: source.languageVerificationNotes,
  speaker_identification: source.speakerIdentification,
  speaker_notes: source.speakerNotes,
  status: source.status,
  rights_revision: source.rightsRevision,
  created_at: new Date(source.createdAt),
  updated_at: new Date(source.updatedAt),
};

const rightsRow = {
  id: '00000000-0000-4000-8000-000000000201',
  source_id: source.id,
  revision: 1,
  rights_holder: 'Example rights holder',
  license: 'Research permission',
  permission_evidence: 'Restricted record PERM-01',
  attribution_requirements: 'Credit the rights holder.',
  allow_internal_processing: true,
  allow_volunteer_access: true,
  allow_transcription: true,
  allow_ml_research: false,
  allow_public_distribution: false,
  decision: 'approved',
  changed_by: 'ADMIN-01',
  change_reason: 'Written permission reviewed.',
  created_at: new Date('2026-10-25T09:00:00.000Z'),
};

describe('NeonSourceRepository', () => {
  it('maps source rows and handles PostgreSQL bigint duration values', async () => {
    const database: SqlExecutor = { query: vi.fn().mockResolvedValue([sourceRow]) };
    await expect(new NeonSourceRepository(database).list(source.projectId, false)).resolves.toEqual([source]);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("status NOT IN ('rejected', 'revoked')"), [source.projectId, false]);
  });

  it('uses placeholders instead of interpolating source metadata', async () => {
    const query = vi.fn().mockResolvedValue([sourceRow]);
    await new NeonSourceRepository({ query }).create(source);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('$1');
    expect(sql).not.toContain(source.title);
    expect(values).toContain(source.title);
    expect(values).toContain(source.originalUrl);
  });

  it('protects metadata updates from overwriting a concurrent rights revision', async () => {
    const query = vi.fn().mockResolvedValue([sourceRow]);
    await new NeonSourceRepository({ query }).updateMetadata(source);
    expect(query.mock.calls[0][0]).toContain('rights_revision = $16');
    expect(query.mock.calls[0][1][15]).toBe(source.rightsRevision);
  });

  it('reads immutable rights revisions in chronological order', async () => {
    const query = vi.fn().mockResolvedValue([rightsRow]);
    const revisions = await new NeonSourceRepository({ query }).listRightsHistory(source.id);
    expect(revisions[0]).toMatchObject({
      sourceId: source.id,
      revision: 1,
      decision: 'approved',
      authorizedUses: { transcription: true, publicDistribution: false },
    });
    expect(query.mock.calls[0][0]).toContain('ORDER BY revision ASC');
  });

  it('increments the rights revision and inserts its full snapshot in one statement', async () => {
    const approvedSourceRow = { ...sourceRow, status: 'approved', rights_revision: 1 };
    const query = vi.fn()
      .mockResolvedValueOnce([rightsRow])
      .mockResolvedValueOnce([approvedSourceRow]);
    const repository = new NeonSourceRepository({ query });
    const result = await repository.addRightsRevision({
      id: rightsRow.id,
      sourceId: source.id,
      status: 'approved',
      createdAt: '2026-10-25T09:00:00.000Z',
      draft: {
        rightsHolder: rightsRow.rights_holder,
        license: rightsRow.license,
        permissionEvidence: rightsRow.permission_evidence,
        attributionRequirements: rightsRow.attribution_requirements,
        authorizedUses: {
          internalProcessing: true,
          volunteerAccess: true,
          transcription: true,
          mlResearch: false,
          publicDistribution: false,
        },
        decision: 'approved',
        changedBy: 'ADMIN-01',
        changeReason: 'Written permission reviewed.',
      },
    });

    expect(result).toMatchObject({ source: { status: 'approved', rightsRevision: 1 }, revision: { revision: 1 } });
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('rights_revision = rights_revision + 1');
    expect(sql).toContain('WITH updated_source AS');
    expect(sql).toContain("language_verification IN ('verified_target', 'mixed_target')");
    expect(values).toContain('approved');
    expect(values).toContain('Restricted record PERM-01');
  });

  it('fails closed when a persisted rights row violates the shared contract', async () => {
    const repository = new NeonSourceRepository({
      query: vi.fn().mockResolvedValue([{ ...rightsRow, decision: 'revoked', allow_transcription: true }]),
    });
    await expect(repository.getLatestRights(source.id)).rejects.toThrow();
  });
});
