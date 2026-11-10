import type { SqlExecutor } from '../database/neon';
import type { Contributor, NextClip, Submission } from './volunteer';
import type { BatchProgress, SubmissionRecord, VolunteerRepository } from './volunteer-repository';

type Timestamp = string | Date;
const iso = (value: Timestamp) => (value instanceof Date ? value : new Date(value)).toISOString();

export class NeonVolunteerRepository implements VolunteerRepository {
  constructor(private readonly database: SqlExecutor) {}

  async listSubmissionsForSource(sourceId: string): Promise<SubmissionRecord[]> {
    const rows = await this.database.query<{
      id: string; clip_id: string; batch_id: string; contributor_id: string; pseudonym: string;
      kind: string; transcript_text: string | null; created_at: Timestamp;
    }>(`
      SELECT s.id, s.clip_id, s.batch_id, s.contributor_id, k.pseudonym, s.kind, s.transcript_text, s.created_at
      FROM submissions s
      JOIN batches b ON b.id = s.batch_id
      JOIN contributors k ON k.id = s.contributor_id
      WHERE b.source_id = $1
      ORDER BY s.created_at ASC, s.id ASC
    `, [sourceId]);
    return rows.map((row) => ({
      id: row.id,
      clipId: row.clip_id,
      batchId: row.batch_id,
      contributorId: row.contributor_id,
      pseudonym: row.pseudonym,
      kind: row.kind === 'skip' ? 'skip' : 'transcript',
      text: row.transcript_text,
      createdAt: iso(row.created_at),
    }));
  }

  async createContributor(contributor: Contributor): Promise<Contributor> {
    await this.database.query(
      'INSERT INTO contributors (id, project_id, pseudonym, created_at) VALUES ($1, $2, $3, $4)',
      [contributor.id, contributor.projectId, contributor.pseudonym, contributor.createdAt],
    );
    return contributor;
  }

  async countContributorsSince(projectId: string, since: string): Promise<number> {
    const rows = await this.database.query<{ total: number | string }>(
      'SELECT count(*) AS total FROM contributors WHERE project_id = $1 AND created_at >= $2', [projectId, since],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async getContributor(id: string): Promise<Contributor | null> {
    const rows = await this.database.query<{ id: string; project_id: string; pseudonym: string; created_at: Timestamp }>(
      'SELECT id, project_id, pseudonym, created_at FROM contributors WHERE id = $1', [id],
    );
    const row = rows[0];
    return row ? { id: row.id, projectId: row.project_id, pseudonym: row.pseudonym, createdAt: iso(row.created_at) } : null;
  }

  async nextClip(batchId: string, contributorId: string, requiredTranscripts: number): Promise<NextClip | null> {
    const rows = await this.database.query<{ clip_id: string; position: number; duration_ms: number }>(`
      SELECT bc.clip_id, bc.position, c.duration_ms
      FROM batch_clips bc
      JOIN clips c ON c.id = bc.clip_id
      WHERE bc.batch_id = $1 AND c.status = 'published'
        AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.clip_id = bc.clip_id AND s.contributor_id = $2)
        AND (SELECT count(*) FROM submissions s WHERE s.clip_id = bc.clip_id AND s.kind = 'transcript') < $3
      ORDER BY bc.position ASC
      LIMIT 1
    `, [batchId, contributorId, requiredTranscripts]);
    const row = rows[0];
    return row ? { clipId: row.clip_id, position: Number(row.position), durationMs: Number(row.duration_ms) } : null;
  }

  async progress(batchId: string, contributorId: string, requiredTranscripts: number): Promise<BatchProgress> {
    const rows = await this.database.query<{ answered: number | string; remaining: number | string }>(`
      SELECT
        (SELECT count(*) FROM submissions s JOIN clips c ON c.id = s.clip_id
          WHERE s.batch_id = $1 AND s.contributor_id = $2 AND c.status = 'published') AS answered,
        (SELECT count(*) FROM batch_clips bc JOIN clips c ON c.id = bc.clip_id
          WHERE bc.batch_id = $1 AND c.status = 'published'
            AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.clip_id = bc.clip_id AND s.contributor_id = $2)
            AND (SELECT count(*) FROM submissions s WHERE s.clip_id = bc.clip_id AND s.kind = 'transcript') < $3) AS remaining
    `, [batchId, contributorId, requiredTranscripts]);
    const answered = Number(rows[0]?.answered ?? 0);
    // "Of N" counts what this person can do: their own answers plus the clips still open to them.
    return { total: answered + Number(rows[0]?.remaining ?? 0), answered };
  }

  async appendSubmission(submission: Submission): Promise<'recorded' | 'already_answered' | 'unavailable'> {
    const inserted = await this.database.query(`
      INSERT INTO submissions (id, clip_id, batch_id, contributor_id, kind, transcript_text, created_at)
      SELECT $1, $2, $3, $4, $5, $6, $7
      FROM batch_clips bc
      JOIN batches b ON b.id = bc.batch_id
      JOIN clips c ON c.id = bc.clip_id
      JOIN contributors k ON k.id = $4 AND k.project_id = b.project_id
      JOIN sources s ON s.id = b.source_id AND s.project_id = b.project_id
      JOIN source_rights_revisions r ON r.source_id = s.id AND r.revision = s.rights_revision
      JOIN projects p ON p.id = b.project_id
      WHERE bc.batch_id = $3 AND bc.clip_id = $2 AND b.status = 'open' AND c.status = 'published'
        AND s.status = 'approved' AND p.status = 'active'
        AND r.decision = 'approved' AND r.allow_volunteer_access = TRUE AND r.allow_transcription = TRUE
      ON CONFLICT (clip_id, contributor_id) DO NOTHING
      RETURNING id
    `, [submission.id, submission.clipId, submission.batchId, submission.contributorId, submission.kind, submission.text, submission.createdAt]);
    if (inserted.length === 1) return 'recorded';
    const existing = await this.database.query(
      'SELECT 1 FROM submissions WHERE clip_id = $1 AND contributor_id = $2', [submission.clipId, submission.contributorId],
    );
    return existing.length > 0 ? 'already_answered' : 'unavailable';
  }
}
