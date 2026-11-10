import type { SqlExecutor } from '../database/neon';
import type { FinalTranscript } from './final';
import type { FinalRepository } from './final-repository';

type Timestamp = string | Date;
type Row = {
  id: string; clip_id: string; version: number; decision: string; transcript_text: string | null;
  chosen_submission_id: string | null; note: string; created_by: string; created_at: Timestamp;
};

const iso = (value: Timestamp) => (value instanceof Date ? value : new Date(value)).toISOString();
const COLUMNS = 'f.id, f.clip_id, f.version, f.decision, f.transcript_text, f.chosen_submission_id, f.note, f.created_by, f.created_at';

function map(row: Row): FinalTranscript {
  return {
    id: row.id,
    clipId: row.clip_id,
    version: Number(row.version),
    decision: row.decision === 'excluded' ? 'excluded' : 'approved',
    text: row.transcript_text,
    chosenSubmissionId: row.chosen_submission_id,
    note: row.note,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
  };
}

export class NeonFinalRepository implements FinalRepository {
  constructor(private readonly database: SqlExecutor) {}

  async append(record: Omit<FinalTranscript, 'version'>): Promise<FinalTranscript | null> {
    const rows = await this.database.query<Row>(`
      INSERT INTO final_transcripts (id, clip_id, version, decision, transcript_text, chosen_submission_id, note, created_by, created_at)
      SELECT $1, $2, COALESCE((SELECT max(version) FROM final_transcripts WHERE clip_id = $2), 0) + 1, $3, $4, $5, $6, $7, $8
      WHERE EXISTS (SELECT 1 FROM batch_clips WHERE clip_id = $2)
        AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM submissions s WHERE s.id = $5::uuid AND s.clip_id = $2 AND s.kind = 'transcript'))
      RETURNING id, clip_id, version, decision, transcript_text, chosen_submission_id, note, created_by, created_at
    `, [record.id, record.clipId, record.decision, record.text, record.chosenSubmissionId, record.note, record.createdBy, record.createdAt]);
    return rows[0] ? map(rows[0]) : null;
  }

  async latestForSource(sourceId: string): Promise<FinalTranscript[]> {
    const rows = await this.database.query<Row>(`
      SELECT DISTINCT ON (f.clip_id) ${COLUMNS}
      FROM final_transcripts f
      JOIN clips c ON c.id = f.clip_id
      WHERE c.source_id = $1
      ORDER BY f.clip_id, f.version DESC
    `, [sourceId]);
    return rows.map(map);
  }

  async historyForClip(clipId: string): Promise<FinalTranscript[]> {
    const rows = await this.database.query<Row>(`SELECT ${COLUMNS} FROM final_transcripts f WHERE f.clip_id = $1 ORDER BY f.version ASC`, [clipId]);
    return rows.map(map);
  }
}
