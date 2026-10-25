import type { SqlExecutor } from '../database/neon';
import type { SourceRepository } from './source-repository';
import {
  sourceRightsRevisionSchema,
  sourceSchema,
  type Source,
  type SourceRightsRevision,
} from './source';

type SourceRow = {
  id: string;
  project_id: string;
  source_type: string;
  title: string;
  original_url: string | null;
  creator: string | null;
  source_date: string | Date | null;
  duration_ms: number | string | null;
  external_reference: string | null;
  language_verification: string;
  language_verified_by: string | null;
  language_verification_notes: string;
  speaker_identification: string;
  speaker_notes: string;
  status: string;
  rights_revision: number;
  created_at: string | Date;
  updated_at: string | Date;
};

type RightsRow = {
  id: string;
  source_id: string;
  revision: number;
  rights_holder: string | null;
  license: string | null;
  permission_evidence: string | null;
  attribution_requirements: string | null;
  allow_internal_processing: boolean;
  allow_volunteer_access: boolean;
  allow_transcription: boolean;
  allow_ml_research: boolean;
  allow_public_distribution: boolean;
  decision: string;
  changed_by: string;
  change_reason: string;
  created_at: string | Date;
};

const SOURCE_COLUMNS = `
  id, project_id, source_type, title, original_url, creator, source_date,
  duration_ms, external_reference, language_verification, language_verified_by, language_verification_notes,
  speaker_identification, speaker_notes, status, rights_revision, created_at, updated_at
`;

const RIGHTS_COLUMNS = `
  id, source_id, revision, rights_holder, license, permission_evidence,
  attribution_requirements, allow_internal_processing, allow_volunteer_access,
  allow_transcription, allow_ml_research, allow_public_distribution,
  decision, changed_by, change_reason, created_at
`;

function isoTimestamp(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function dateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function mapSource(row: SourceRow): Source {
  return sourceSchema.parse({
    id: row.id,
    projectId: row.project_id,
    sourceType: row.source_type,
    title: row.title,
    originalUrl: row.original_url,
    creator: row.creator,
    sourceDate: dateOnly(row.source_date),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    externalReference: row.external_reference,
    languageVerification: row.language_verification,
    languageVerifiedBy: row.language_verified_by,
    languageVerificationNotes: row.language_verification_notes,
    speakerIdentification: row.speaker_identification,
    speakerNotes: row.speaker_notes,
    status: row.status,
    rightsRevision: row.rights_revision,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  });
}

function mapRights(row: RightsRow): SourceRightsRevision {
  return sourceRightsRevisionSchema.parse({
    id: row.id,
    sourceId: row.source_id,
    revision: row.revision,
    rightsHolder: row.rights_holder,
    license: row.license,
    permissionEvidence: row.permission_evidence,
    attributionRequirements: row.attribution_requirements,
    authorizedUses: {
      internalProcessing: row.allow_internal_processing,
      volunteerAccess: row.allow_volunteer_access,
      transcription: row.allow_transcription,
      mlResearch: row.allow_ml_research,
      publicDistribution: row.allow_public_distribution,
    },
    decision: row.decision,
    changedBy: row.changed_by,
    changeReason: row.change_reason,
    createdAt: isoTimestamp(row.created_at),
  });
}

export class NeonSourceRepository implements SourceRepository {
  constructor(private readonly database: SqlExecutor) {}

  async list(projectId: string, includeInactive: boolean): Promise<Source[]> {
    const rows = await this.database.query<SourceRow>(`
      SELECT ${SOURCE_COLUMNS}
      FROM sources
      WHERE project_id = $1
        AND ($2::boolean OR status NOT IN ('rejected', 'revoked'))
      ORDER BY title ASC, id ASC
    `, [projectId, includeInactive]);
    return rows.map(mapSource);
  }

  async getById(id: string): Promise<Source | null> {
    const rows = await this.database.query<SourceRow>(`
      SELECT ${SOURCE_COLUMNS}
      FROM sources
      WHERE id = $1
    `, [id]);
    return rows[0] ? mapSource(rows[0]) : null;
  }

  async getLatestRights(sourceId: string): Promise<SourceRightsRevision | null> {
    const rows = await this.database.query<RightsRow>(`
      SELECT ${RIGHTS_COLUMNS}
      FROM source_rights_revisions
      WHERE source_id = $1
      ORDER BY revision DESC
      LIMIT 1
    `, [sourceId]);
    return rows[0] ? mapRights(rows[0]) : null;
  }

  async listRightsHistory(sourceId: string): Promise<SourceRightsRevision[]> {
    const rows = await this.database.query<RightsRow>(`
      SELECT ${RIGHTS_COLUMNS}
      FROM source_rights_revisions
      WHERE source_id = $1
      ORDER BY revision ASC
    `, [sourceId]);
    return rows.map(mapRights);
  }

  async create(source: Source): Promise<Source> {
    const rows = await this.database.query<SourceRow>(`
      INSERT INTO sources (
        id, project_id, source_type, title, original_url, creator, source_date,
        duration_ms, external_reference, language_verification, language_verified_by, language_verification_notes,
        speaker_identification, speaker_notes, status, rights_revision, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18
      )
      RETURNING ${SOURCE_COLUMNS}
    `, sourceValues(source));
    return mapSource(requireRow(rows, 'source'));
  }

  async updateMetadata(source: Source): Promise<Source | null> {
    const rows = await this.database.query<SourceRow>(`
      UPDATE sources
      SET source_type = $3,
          title = $4,
          original_url = $5,
          creator = $6,
          source_date = $7,
          duration_ms = $8,
          external_reference = $9,
          language_verification = $10,
          language_verified_by = $11,
          language_verification_notes = $12,
          speaker_identification = $13,
          speaker_notes = $14,
          status = $15,
          updated_at = $18
      WHERE id = $1 AND project_id = $2 AND rights_revision = $16
      RETURNING ${SOURCE_COLUMNS}
    `, sourceValues(source));
    return rows[0] ? mapSource(rows[0]) : null;
  }

  async addRightsRevision(input: Parameters<SourceRepository['addRightsRevision']>[0]) {
    const uses = input.draft.authorizedUses;
    const rows = await this.database.query<RightsRow>(`
      WITH updated_source AS (
        UPDATE sources
        SET status = $2,
            rights_revision = rights_revision + 1,
            updated_at = $3
        WHERE id = $1
          AND ($2 <> 'approved' OR language_verification IN ('verified_target', 'mixed_target'))
        RETURNING rights_revision
      )
      INSERT INTO source_rights_revisions (
        id, source_id, revision, rights_holder, license, permission_evidence,
        attribution_requirements, allow_internal_processing, allow_volunteer_access,
        allow_transcription, allow_ml_research, allow_public_distribution,
        decision, changed_by, change_reason, created_at
      )
      SELECT
        $4, $1, rights_revision, $5, $6, $7,
        $8, $9, $10,
        $11, $12, $13,
        $14, $15, $16, $3
      FROM updated_source
      RETURNING ${RIGHTS_COLUMNS}
    `, [
      input.sourceId,
      input.status,
      input.createdAt,
      input.id,
      input.draft.rightsHolder,
      input.draft.license,
      input.draft.permissionEvidence,
      input.draft.attributionRequirements,
      uses.internalProcessing,
      uses.volunteerAccess,
      uses.transcription,
      uses.mlResearch,
      uses.publicDistribution,
      input.draft.decision,
      input.draft.changedBy,
      input.draft.changeReason,
    ]);
    if (!rows[0]) return null;
    const source = await this.getById(input.sourceId);
    if (!source) throw new Error('The source was not readable after saving its rights revision.');
    return { source, revision: mapRights(rows[0]) };
  }
}

function sourceValues(source: Source): readonly unknown[] {
  return [
    source.id,
    source.projectId,
    source.sourceType,
    source.title,
    source.originalUrl,
    source.creator,
    source.sourceDate,
    source.durationMs,
    source.externalReference,
    source.languageVerification,
    source.languageVerifiedBy,
    source.languageVerificationNotes,
    source.speakerIdentification,
    source.speakerNotes,
    source.status,
    source.rightsRevision,
    source.createdAt,
    source.updatedAt,
  ];
}

function requireRow<Row>(rows: Row[], label: string): Row {
  const row = rows[0];
  if (!row) throw new Error(`The database did not return the saved ${label}.`);
  return row;
}
