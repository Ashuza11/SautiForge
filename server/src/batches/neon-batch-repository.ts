import type { SqlExecutor } from '../database/neon';
import { batchSchema, type Batch, type BatchWithClips } from './batch';
import type { BatchRepository } from './batch-repository';

type Timestamp = string | Date;
type BatchRow = {
  id: string;
  project_id: string;
  source_id: string;
  title: string;
  status: string;
  created_by: string;
  created_at: Timestamp;
  closed_at: Timestamp | null;
};
type ClipRow = { batch_id: string; clip_id: string };

const iso = (value: Timestamp) => (value instanceof Date ? value : new Date(value)).toISOString();

export class NeonBatchRepository implements BatchRepository {
  constructor(private readonly database: SqlExecutor) {}

  listForSource(sourceId: string): Promise<BatchWithClips[]> {
    return this.load('b.source_id = $1', [sourceId]);
  }

  async getById(id: string): Promise<BatchWithClips | null> {
    return (await this.load('b.id = $1', [id]))[0] ?? null;
  }

  async countForSource(sourceId: string): Promise<number> {
    const rows = await this.database.query<{ total: number | string }>('SELECT count(*) AS total FROM batches WHERE source_id = $1', [sourceId]);
    return Number(rows[0]?.total ?? 0);
  }

  async createWhenEligible(batch: Batch, clipIds: string[]): Promise<BatchWithClips | null> {
    const rows = await this.database.query(`
      WITH eligible AS (
        SELECT count(*) AS total
        FROM clips c
        WHERE c.id = ANY($7::uuid[]) AND c.source_id = $3 AND c.project_id = $2 AND c.status = 'published'
          AND NOT EXISTS (
            SELECT 1 FROM batch_clips bc JOIN batches b ON b.id = bc.batch_id
            WHERE bc.clip_id = c.id AND b.status = 'open'
          )
      ), new_batch AS (
        INSERT INTO batches (id, project_id, source_id, title, status, created_by, created_at, closed_at)
        SELECT $1, $2, $3, $4, $5, $6, $8, NULL
        FROM sources s
        JOIN source_rights_revisions r ON r.source_id = s.id AND r.revision = s.rights_revision
        JOIN projects p ON p.id = s.project_id
        WHERE s.id = $3 AND s.project_id = $2 AND s.status = 'approved' AND p.status = 'active'
          AND r.decision = 'approved' AND r.allow_volunteer_access = TRUE AND r.allow_transcription = TRUE
          AND (SELECT total FROM eligible) = $9
        RETURNING id
      )
      INSERT INTO batch_clips (batch_id, clip_id, position)
      SELECT nb.id, x.clip_id, x.position::integer
      FROM new_batch nb, unnest($7::uuid[]) WITH ORDINALITY AS x(clip_id, position)
      RETURNING clip_id
    `, [batch.id, batch.projectId, batch.sourceId, batch.title, batch.status, batch.createdBy, clipIds, batch.createdAt, clipIds.length]);
    return rows.length === clipIds.length ? this.getById(batch.id) : null;
  }

  async close(id: string, now: string): Promise<boolean> {
    const rows = await this.database.query(`
      UPDATE batches SET status = 'closed', closed_at = $2 WHERE id = $1 AND status = 'open' RETURNING id
    `, [id, now]);
    return rows.length === 1;
  }

  private async load(where: string, values: readonly unknown[]): Promise<BatchWithClips[]> {
    const batches = await this.database.query<BatchRow>(`
      SELECT b.id, b.project_id, b.source_id, b.title, b.status, b.created_by, b.created_at, b.closed_at
      FROM batches b WHERE ${where} ORDER BY b.created_at ASC, b.id ASC
    `, values);
    if (batches.length === 0) return [];
    const clips = await this.database.query<ClipRow>(`
      SELECT batch_id, clip_id FROM batch_clips WHERE batch_id = ANY($1::uuid[]) ORDER BY batch_id ASC, position ASC
    `, [batches.map((row) => row.id)]);
    return batches.map((row) => ({
      batch: batchSchema.parse({
        id: row.id,
        projectId: row.project_id,
        sourceId: row.source_id,
        title: row.title,
        status: row.status,
        createdBy: row.created_by,
        createdAt: iso(row.created_at),
        closedAt: row.closed_at === null ? null : iso(row.closed_at),
      }),
      clipIds: clips.filter((clip) => clip.batch_id === row.id).map((clip) => clip.clip_id),
    }));
  }
}
