import type { SQLiteDatabase } from 'expo-sqlite';

import { newId, nowIso } from '@/domain/common';
import { transcriptionDraftSchema, transcriptionSchema, type Transcription, type TranscriptionDraft } from '../domain/transcription';
import type { TranscriptionRepository } from './transcription-repository';

type Row = { id: string; recording_id: string; verbatim_text: string | null; normalized_text: string | null; language_tags_json: string; notes: string | null; source: Transcription['source']; revision_number: number; supersedes_id: string | null; created_at: string; created_by: string | null };
const columns = 'id, recording_id, verbatim_text, normalized_text, language_tags_json, notes, source, revision_number, supersedes_id, created_at, created_by';
const fromRow = (row: Row): Transcription => transcriptionSchema.parse({ id: row.id, recordingId: row.recording_id, verbatimText: row.verbatim_text, normalizedText: row.normalized_text, languageTags: JSON.parse(row.language_tags_json), notes: row.notes, source: row.source, revisionNumber: row.revision_number, supersedesId: row.supersedes_id, createdAt: row.created_at, createdBy: row.created_by });

export class SQLiteTranscriptionRepository implements TranscriptionRepository {
  constructor(private readonly db: SQLiteDatabase) {}
  async listRevisions(recordingId: string): Promise<Transcription[]> {
    return (await this.db.getAllAsync<Row>(`SELECT ${columns} FROM transcriptions WHERE recording_id = ? ORDER BY revision_number DESC`, recordingId)).map(fromRow);
  }
  async getCurrent(recordingId: string): Promise<Transcription | null> {
    const row = await this.db.getFirstAsync<Row>(`SELECT ${columns} FROM transcriptions WHERE recording_id = ? ORDER BY revision_number DESC LIMIT 1`, recordingId);
    return row ? fromRow(row) : null;
  }
  async createRevision(recordingId: string, input: TranscriptionDraft): Promise<Transcription> {
    const draft = transcriptionDraftSchema.parse(input);
    const id = newId();
    await this.db.withExclusiveTransactionAsync(async (transaction) => {
      const previous = await transaction.getFirstAsync<Row>(`SELECT ${columns} FROM transcriptions WHERE recording_id = ? ORDER BY revision_number DESC LIMIT 1`, recordingId);
      const transcription = transcriptionSchema.parse({ ...draft, id, recordingId, source: 'human', revisionNumber: (previous?.revision_number ?? 0) + 1, supersedesId: previous?.id ?? null, createdAt: nowIso() });
      await transaction.runAsync(
        `INSERT INTO transcriptions (id, recording_id, verbatim_text, normalized_text, language_tags_json, notes, source, revision_number, supersedes_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        transcription.id, transcription.recordingId, transcription.verbatimText, transcription.normalizedText, JSON.stringify(transcription.languageTags), transcription.notes, transcription.source, transcription.revisionNumber, transcription.supersedesId, transcription.createdAt, transcription.createdBy,
      );
    });
    const saved = await this.db.getFirstAsync<Row>(`SELECT ${columns} FROM transcriptions WHERE id = ?`, id);
    if (!saved) throw new Error('Transcription revision was not readable after saving.');
    return fromRow(saved);
  }
}
