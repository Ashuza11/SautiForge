import type { SqlExecutor } from '../database/neon';
import { sourceMediaSchema, type SourceMedia } from './source-media';
import type { SourceMediaRepository } from './source-media-repository';

type SourceMediaRow = {
  id: string;
  project_id: string;
  source_id: string;
  rights_revision: number;
  object_key: string;
  client_filename: string;
  content_type: string;
  size_bytes: number | string;
  sha256_hex: string;
  status: string;
  verification_error: string | null;
  upload_expires_at: string | Date;
  verified_at: string | Date | null;
  created_by: string;
  created_at: string | Date;
  updated_at: string | Date;
};

const MEDIA_COLUMNS = `
  id, project_id, source_id, rights_revision, object_key, client_filename,
  content_type, size_bytes, sha256_hex, status, verification_error,
  upload_expires_at, verified_at, created_by, created_at, updated_at
`;

export class NeonSourceMediaRepository implements SourceMediaRepository {
  constructor(private readonly database: SqlExecutor) {}

  async listForSource(sourceId: string): Promise<SourceMedia[]> {
    const rows = await this.database.query<SourceMediaRow>(`
      SELECT ${MEDIA_COLUMNS}
      FROM source_media
      WHERE source_id = $1
      ORDER BY created_at ASC, id ASC
    `, [sourceId]);
    return rows.map(mapSourceMedia);
  }

  async getById(id: string): Promise<SourceMedia | null> {
    const rows = await this.database.query<SourceMediaRow>(`
      SELECT ${MEDIA_COLUMNS}
      FROM source_media
      WHERE id = $1
    `, [id]);
    return rows[0] ? mapSourceMedia(rows[0]) : null;
  }

  async createWhenAuthorized(media: SourceMedia): Promise<SourceMedia | null> {
    const rows = await this.database.query<SourceMediaRow>(`
      INSERT INTO source_media (
        id, project_id, source_id, rights_revision, object_key, client_filename,
        content_type, size_bytes, sha256_hex, status, verification_error,
        upload_expires_at, verified_at, created_by, created_at, updated_at
      )
      SELECT
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16
      FROM sources source
      JOIN source_rights_revisions rights
        ON rights.source_id = source.id AND rights.revision = source.rights_revision
      JOIN projects project ON project.id = source.project_id
      WHERE source.id = $3
        AND source.project_id = $2
        AND source.status = 'approved'
        AND source.rights_revision = $4
        AND project.status = 'active'
        AND rights.decision = 'approved'
        AND rights.allow_internal_processing = TRUE
      RETURNING ${MEDIA_COLUMNS}
    `, mediaValues(media));
    return rows[0] ? mapSourceMedia(rows[0]) : null;
  }

  async updateVerification(input: Parameters<SourceMediaRepository['updateVerification']>[0]): Promise<SourceMedia | null> {
    const rows = await this.database.query<SourceMediaRow>(`
      UPDATE source_media media
      SET status = $3,
          verification_error = $4,
          verified_at = $5,
          updated_at = $6
      FROM sources source
      JOIN source_rights_revisions rights
        ON rights.source_id = source.id AND rights.revision = source.rights_revision
      JOIN projects project ON project.id = source.project_id
      WHERE media.id = $1
        AND media.status = $2
        AND source.id = media.source_id
        AND source.project_id = media.project_id
        AND source.status = 'approved'
        AND project.status = 'active'
        AND rights.decision = 'approved'
        AND rights.allow_internal_processing = TRUE
      RETURNING ${MEDIA_COLUMNS.replaceAll(/\b(id|project_id|source_id|rights_revision|status|updated_at)\b/g, 'media.$1')}
    `, [
      input.id,
      input.expectedStatus,
      input.status,
      input.verificationError,
      input.verifiedAt,
      input.updatedAt,
    ]);
    return rows[0] ? mapSourceMedia(rows[0]) : null;
  }
}

function mapSourceMedia(row: SourceMediaRow): SourceMedia {
  return sourceMediaSchema.parse({
    id: row.id,
    projectId: row.project_id,
    sourceId: row.source_id,
    rightsRevision: row.rights_revision,
    objectKey: row.object_key,
    fileName: row.client_filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256_hex,
    status: row.status,
    verificationError: row.verification_error,
    uploadExpiresAt: isoTimestamp(row.upload_expires_at),
    verifiedAt: row.verified_at === null ? null : isoTimestamp(row.verified_at),
    createdBy: row.created_by,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  });
}

function mediaValues(media: SourceMedia): readonly unknown[] {
  return [
    media.id,
    media.projectId,
    media.sourceId,
    media.rightsRevision,
    media.objectKey,
    media.fileName,
    media.contentType,
    media.sizeBytes,
    media.sha256,
    media.status,
    media.verificationError,
    media.uploadExpiresAt,
    media.verifiedAt,
    media.createdBy,
    media.createdAt,
    media.updatedAt,
  ];
}

function isoTimestamp(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
