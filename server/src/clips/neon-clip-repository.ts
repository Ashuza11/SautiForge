import type { SqlExecutor } from '../database/neon';
import {
  clipAudioFileSchema,
  clipSchema,
  type Clip,
  type ClipAudioFile,
  type ClipStatus,
  type ClipWithFiles,
} from './clip';
import type { ClipMetadataUpdate, ClipRepository } from './clip-repository';

type Timestamp = string | Date;

type ClipRow = {
  id: string;
  project_id: string;
  source_id: string;
  rights_revision: number;
  clip_key: string;
  start_ms: number;
  end_ms: number;
  trimmed_ms: number;
  duration_ms: number;
  speaker_role: string;
  speaker_name: string | null;
  has_music: boolean;
  tier: string;
  status: string;
  segmenter: string | null;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  published_at: Timestamp | null;
  withdrawn_at: Timestamp | null;
};

type FileRow = {
  id: string;
  clip_id: string;
  variant: string;
  object_key: string;
  content_type: string;
  size_bytes: number;
  sha256_hex: string;
  sample_rate: number;
  duration_ms: number;
  status: string;
  verification_error: string | null;
  upload_expires_at: Timestamp;
  verified_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

const CLIP_COLUMNS = `
  id, project_id, source_id, rights_revision, clip_key, start_ms, end_ms, trimmed_ms,
  duration_ms, speaker_role, speaker_name, has_music, tier, status, segmenter,
  created_by, created_at, updated_at, published_at, withdrawn_at
`;

const FILE_COLUMNS = `
  id, clip_id, variant, object_key, content_type, size_bytes, sha256_hex, sample_rate,
  duration_ms, status, verification_error, upload_expires_at, verified_at, created_at, updated_at
`;

const FILE_RECORD = `
  id uuid, clip_id uuid, variant text, object_key text, content_type text, size_bytes integer,
  sha256_hex text, sample_rate integer, duration_ms integer, status text,
  upload_expires_at timestamptz, created_at timestamptz, updated_at timestamptz
`;

/** True when the clip's source is approved, its project is active and the named right is granted. */
function authorized(clipAlias: string, right: 'allow_internal_processing' | 'allow_volunteer_access' | 'allow_transcription'): string {
  return `EXISTS (
    SELECT 1 FROM sources s
    JOIN source_rights_revisions r ON r.source_id = s.id AND r.revision = s.rights_revision
    JOIN projects p ON p.id = s.project_id
    WHERE s.id = ${clipAlias}.source_id AND s.project_id = ${clipAlias}.project_id
      AND s.status = 'approved' AND p.status = 'active'
      AND r.decision = 'approved' AND r.${right} = TRUE
  )`;
}

export class NeonClipRepository implements ClipRepository {
  constructor(private readonly database: SqlExecutor) {}

  listForSource(sourceId: string, status?: ClipStatus): Promise<ClipWithFiles[]> {
    return this.load('c.source_id = $1 AND ($2::text IS NULL OR c.status = $2)', [sourceId, status ?? null]);
  }

  async getById(id: string): Promise<ClipWithFiles | null> {
    return (await this.load('c.id = $1', [id]))[0] ?? null;
  }

  async findByKey(sourceId: string, clipKey: string): Promise<ClipWithFiles | null> {
    return (await this.load('c.source_id = $1 AND c.clip_key = $2', [sourceId, clipKey]))[0] ?? null;
  }

  async createWhenAuthorized(clip: Clip, files: ClipAudioFile[]): Promise<ClipWithFiles | null> {
    const rows = await this.database.query(`
      WITH new_clip AS (
        INSERT INTO clips (
          id, project_id, source_id, rights_revision, clip_key, start_ms, end_ms, trimmed_ms,
          duration_ms, speaker_role, speaker_name, has_music, tier, status, segmenter,
          created_by, created_at, updated_at, published_at, withdrawn_at
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        FROM sources source
        JOIN source_rights_revisions rights
          ON rights.source_id = source.id AND rights.revision = source.rights_revision
        JOIN projects project ON project.id = source.project_id
        WHERE source.id = $3 AND source.project_id = $2
          AND source.status = 'approved' AND source.rights_revision = $4
          AND project.status = 'active'
          AND rights.decision = 'approved' AND rights.allow_internal_processing = TRUE
        RETURNING id
      )
      INSERT INTO clip_audio_files (
        id, clip_id, variant, object_key, content_type, size_bytes, sha256_hex, sample_rate,
        duration_ms, status, verification_error, upload_expires_at, verified_at, created_at, updated_at
      )
      SELECT f.id, f.clip_id, f.variant, f.object_key, f.content_type, f.size_bytes, f.sha256_hex,
             f.sample_rate, f.duration_ms, f.status, NULL, f.upload_expires_at, NULL, f.created_at, f.updated_at
      FROM new_clip, jsonb_to_recordset($21::jsonb) AS f(${FILE_RECORD})
      WHERE f.clip_id = new_clip.id
      RETURNING id
    `, [
      clip.id, clip.projectId, clip.sourceId, clip.rightsRevision, clip.clipKey,
      clip.startMs, clip.endMs, clip.trimmedMs, clip.durationMs, clip.speakerRole,
      clip.speakerName, clip.hasMusic, clip.tier, clip.status, clip.segmenter,
      clip.createdBy, clip.createdAt, clip.updatedAt, clip.publishedAt, clip.withdrawnAt,
      JSON.stringify(files.map(fileJson)),
    ]);
    return rows.length === files.length ? this.getById(clip.id) : null;
  }

  async updateMetadata(id: string, update: ClipMetadataUpdate, updatedAt: string): Promise<boolean> {
    const rows = await this.database.query(`
      UPDATE clips c
      SET speaker_role = $2, speaker_name = $3, has_music = $4, tier = $5, segmenter = $6, updated_at = $7
      WHERE c.id = $1 AND c.status <> 'withdrawn' AND ${authorized('c', 'allow_internal_processing')}
      RETURNING c.id
    `, [id, update.speakerRole, update.speakerName, update.hasMusic, update.tier, update.segmenter, updatedAt]);
    return rows.length === 1;
  }

  async insertFile(file: ClipAudioFile): Promise<boolean> {
    const rows = await this.database.query(`
      INSERT INTO clip_audio_files (
        id, clip_id, variant, object_key, content_type, size_bytes, sha256_hex, sample_rate,
        duration_ms, status, verification_error, upload_expires_at, verified_at, created_at, updated_at
      )
      SELECT f.id, f.clip_id, f.variant, f.object_key, f.content_type, f.size_bytes, f.sha256_hex,
             f.sample_rate, f.duration_ms, f.status, NULL, f.upload_expires_at, NULL, f.created_at, f.updated_at
      FROM clips c, jsonb_to_recordset($1::jsonb) AS f(${FILE_RECORD})
      WHERE c.id = f.clip_id AND c.status <> 'withdrawn' AND ${authorized('c', 'allow_internal_processing')}
      RETURNING id
    `, [JSON.stringify([fileJson(file)])]);
    return rows.length === 1;
  }

  async resetFile(file: ClipAudioFile): Promise<boolean> {
    const rows = await this.database.query(`
      UPDATE clip_audio_files f
      SET size_bytes = $2, sha256_hex = $3, sample_rate = $4, duration_ms = $5,
          status = 'upload_pending', verification_error = NULL, verified_at = NULL,
          upload_expires_at = $6, updated_at = $7
      FROM clips c
      WHERE f.id = $1 AND f.status <> 'verified' AND c.id = f.clip_id
        AND c.status <> 'withdrawn' AND ${authorized('c', 'allow_internal_processing')}
      RETURNING f.id
    `, [file.id, file.sizeBytes, file.sha256, file.sampleRate, file.durationMs, file.uploadExpiresAt, file.updatedAt]);
    return rows.length === 1;
  }

  async updateFileVerification(input: Parameters<ClipRepository['updateFileVerification']>[0]): Promise<boolean> {
    const rows = await this.database.query(`
      UPDATE clip_audio_files f
      SET status = $2, verification_error = $3, verified_at = $4, updated_at = $5
      FROM clips c
      WHERE f.id = $1 AND f.status = 'upload_pending' AND c.id = f.clip_id
        AND c.status <> 'withdrawn' AND ${authorized('c', 'allow_internal_processing')}
      RETURNING f.id
    `, [input.id, input.status, input.verificationError, input.verifiedAt, input.updatedAt]);
    return rows.length === 1;
  }

  async publish(id: string, now: string): Promise<boolean> {
    const rows = await this.database.query(`
      UPDATE clips c
      SET status = 'published', published_at = $2, updated_at = $2
      WHERE c.id = $1 AND c.status = 'draft'
        AND ${authorized('c', 'allow_volunteer_access')}
        AND ${authorized('c', 'allow_transcription')}
        AND EXISTS (
          SELECT 1 FROM clip_audio_files f
          WHERE f.clip_id = c.id AND f.variant = 'vocals_htdemucs' AND f.status = 'verified'
        )
        AND NOT EXISTS (
          SELECT 1 FROM clip_audio_files f WHERE f.clip_id = c.id AND f.status <> 'verified'
        )
      RETURNING c.id
    `, [id, now]);
    return rows.length === 1;
  }

  async withdraw(id: string, now: string): Promise<boolean> {
    const rows = await this.database.query(`
      UPDATE clips
      SET status = 'withdrawn', withdrawn_at = $2, updated_at = $2
      WHERE id = $1 AND status <> 'withdrawn'
      RETURNING id
    `, [id, now]);
    return rows.length === 1;
  }

  private async load(where: string, values: readonly unknown[]): Promise<ClipWithFiles[]> {
    const clips = await this.database.query<ClipRow>(`
      SELECT c.*
      FROM clips c
      WHERE ${where}
      ORDER BY c.start_ms ASC, c.clip_key ASC
    `, values);
    if (clips.length === 0) return [];
    const files = await this.database.query<FileRow>(`
      SELECT ${FILE_COLUMNS}
      FROM clip_audio_files
      WHERE clip_id = ANY($1::uuid[])
      ORDER BY clip_id ASC, variant ASC
    `, [clips.map((clip) => clip.id)]);
    return clips.map((clip) => ({
      clip: mapClip(clip),
      files: files.filter((file) => file.clip_id === clip.id).map(mapFile),
    }));
  }
}

function fileJson(file: ClipAudioFile) {
  return {
    id: file.id,
    clip_id: file.clipId,
    variant: file.variant,
    object_key: file.objectKey,
    content_type: file.contentType,
    size_bytes: file.sizeBytes,
    sha256_hex: file.sha256,
    sample_rate: file.sampleRate,
    duration_ms: file.durationMs,
    status: file.status,
    upload_expires_at: file.uploadExpiresAt,
    created_at: file.createdAt,
    updated_at: file.updatedAt,
  };
}

function iso(value: Timestamp): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapClip(row: ClipRow): Clip {
  return clipSchema.parse({
    id: row.id,
    projectId: row.project_id,
    sourceId: row.source_id,
    rightsRevision: row.rights_revision,
    clipKey: row.clip_key,
    startMs: row.start_ms,
    endMs: row.end_ms,
    trimmedMs: row.trimmed_ms,
    durationMs: row.duration_ms,
    speakerRole: row.speaker_role,
    speakerName: row.speaker_name,
    hasMusic: row.has_music,
    tier: row.tier,
    status: row.status,
    segmenter: row.segmenter,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    publishedAt: row.published_at === null ? null : iso(row.published_at),
    withdrawnAt: row.withdrawn_at === null ? null : iso(row.withdrawn_at),
  });
}

function mapFile(row: FileRow): ClipAudioFile {
  return clipAudioFileSchema.parse({
    id: row.id,
    clipId: row.clip_id,
    variant: row.variant,
    objectKey: row.object_key,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256_hex,
    sampleRate: row.sample_rate,
    durationMs: row.duration_ms,
    status: row.status,
    verificationError: row.verification_error,
    uploadExpiresAt: iso(row.upload_expires_at),
    verifiedAt: row.verified_at === null ? null : iso(row.verified_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}
