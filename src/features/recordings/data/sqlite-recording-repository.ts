import type { SQLiteDatabase } from 'expo-sqlite';

import { newId, nowIso } from '@/domain/common';
import type { ConsentRepository } from '@/features/consent/data/consent-repository';
import type { Scenario } from '@/features/scenarios/domain/scenario';
import type { CollectionSession } from '@/features/sessions/domain/session';
import { copyAcceptedTake } from './audio-file-store';
import type { RecordingRepository, RecordingSearch } from './recording-repository';
import { recordingMetadataDraftSchema, recordingSchema, type AcceptedTake, type Recording, type RecordingMetadataDraft } from '../domain/recording';

type ContextRow = {
  session_id: string;
  project_id: string;
  participant_id: string;
  session_status: CollectionSession['status'];
  scenario_id: string;
  scenario_project_id: string;
  scenario_title: string;
  scenario_description: string;
  collection_instructions: string;
  expected_intent: string;
  collection_method: Scenario['collectionMethod'];
  scenario_version: string;
  reference_data_json: string | null;
};

type RecordingRow = {
  id: string; display_id: string; project_id: string; session_id: string; participant_id: string; scenario_id: string;
  consent_record_id: string | null; scenario_version: string; scenario_prompt_snapshot_json: string; relative_audio_path: string;
  collection_method: string; recorded_at: string; duration_ms: number; file_size_bytes: number; container: string; codec: string | null;
  sample_rate_hz: number | null; channel_count: number | null; spoken_languages_json: string; language_variety: string | null;
  code_switching_status: string | null; recording_environment: string | null; noise_level: string | null; quality_rating: number | null;
  notes: string | null; annotation_status: Recording['annotationStatus']; archived_at: string | null; created_at: string; updated_at: string;
};

const columns = `id, display_id, project_id, session_id, participant_id, scenario_id, consent_record_id, scenario_version,
  scenario_prompt_snapshot_json, relative_audio_path, collection_method, recorded_at, duration_ms, file_size_bytes,
  container, codec, sample_rate_hz, channel_count, spoken_languages_json, language_variety, code_switching_status,
  recording_environment, noise_level, quality_rating, notes, annotation_status, archived_at, created_at, updated_at`;

function fromRow(row: RecordingRow): Recording {
  if (!row.consent_record_id) throw new Error('Recording has no linked consent revision.');
  return recordingSchema.parse({
    id: row.id, displayId: row.display_id, projectId: row.project_id, sessionId: row.session_id,
    participantId: row.participant_id, scenarioId: row.scenario_id, consentRecordId: row.consent_record_id,
    scenarioVersion: row.scenario_version, scenarioPromptSnapshot: JSON.parse(row.scenario_prompt_snapshot_json),
    relativeAudioPath: row.relative_audio_path, collectionMethod: row.collection_method, recordedAt: row.recorded_at,
    durationMs: row.duration_ms, fileSizeBytes: row.file_size_bytes, container: row.container, codec: row.codec,
    sampleRateHz: row.sample_rate_hz, channelCount: row.channel_count, spokenLanguages: JSON.parse(row.spoken_languages_json),
    languageVariety: row.language_variety, codeSwitchingStatus: row.code_switching_status,
    recordingEnvironment: row.recording_environment, noiseLevel: row.noise_level, qualityRating: row.quality_rating,
    notes: row.notes, annotationStatus: row.annotation_status, archivedAt: row.archived_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  });
}

export class SQLiteRecordingRepository implements RecordingRepository {
  constructor(private readonly db: SQLiteDatabase, private readonly consent: ConsentRepository) {}

  async listBySession(sessionId: string): Promise<Recording[]> {
    const rows = await this.db.getAllAsync<RecordingRow>(`SELECT ${columns} FROM recordings WHERE session_id = ? AND archived_at IS NULL ORDER BY recorded_at DESC`, sessionId);
    return rows.map(fromRow);
  }

  async search(filters: RecordingSearch): Promise<Recording[]> {
    const conditions = ['r.archived_at IS NULL'];
    const parameters: Array<string | number> = [];
    if (filters.projectId) { conditions.push('r.project_id = ?'); parameters.push(filters.projectId); }
    if (filters.annotationStatus) { conditions.push('r.annotation_status = ?'); parameters.push(filters.annotationStatus); }
    if (filters.language?.trim()) { conditions.push('r.spoken_languages_json LIKE ?'); parameters.push(`%${filters.language.trim()}%`); }
    if (filters.qualityRating) { conditions.push('r.quality_rating = ?'); parameters.push(filters.qualityRating); }
    if (filters.query?.trim()) {
      conditions.push(`(r.display_id LIKE ? OR p.speaker_code LIKE ? OR sc.title LIKE ? OR r.notes LIKE ?)`);
      const query = `%${filters.query.trim()}%`;
      parameters.push(query, query, query, query);
    }
    const rows = await this.db.getAllAsync<RecordingRow>(
      `SELECT ${columns.split(',').map((column) => `r.${column.trim()}`).join(', ')}
       FROM recordings r
       JOIN participants p ON p.id = r.participant_id
       JOIN scenarios sc ON sc.id = r.scenario_id
       WHERE ${conditions.join(' AND ')} ORDER BY r.recorded_at DESC`,
      ...parameters,
    );
    return rows.map(fromRow);
  }

  async get(id: string): Promise<Recording | null> {
    const row = await this.db.getFirstAsync<RecordingRow>(`SELECT ${columns} FROM recordings WHERE id = ?`, id);
    return row ? fromRow(row) : null;
  }

  async saveAcceptedTake(sessionId: string, scenarioId: string, take: AcceptedTake, input: RecordingMetadataDraft): Promise<Recording> {
    const metadata = recordingMetadataDraftSchema.parse(input);
    const context = await this.db.getFirstAsync<ContextRow>(
      `SELECT se.id AS session_id, se.project_id, se.participant_id, se.status AS session_status,
       sc.id AS scenario_id, sc.project_id AS scenario_project_id, sc.title AS scenario_title,
       sc.description AS scenario_description, sc.collection_instructions, sc.expected_intent,
       sc.collection_method, sc.version AS scenario_version, sc.reference_data_json
       FROM sessions se JOIN scenarios sc ON sc.id = ? WHERE se.id = ?`,
      scenarioId,
      sessionId,
    );
    if (!context || context.session_status !== 'in_progress' || context.project_id !== context.scenario_project_id) {
      throw new Error('An active session and scenario from the same project are required.');
    }
    if (!(await this.consent.participantCanRecord(context.participant_id))) {
      throw new Error('Recording consent is no longer valid. The take was not saved.');
    }
    const currentConsent = await this.consent.getCurrent(context.participant_id);
    if (!currentConsent) throw new Error('The authorizing consent revision could not be loaded.');

    const id = newId();
    const timestamp = nowIso();
    const displayId = `SF-${take.recordedAt.slice(0, 10).replaceAll('-', '')}-${id.slice(0, 8).toUpperCase()}`;
    const stored = await copyAcceptedTake(take.sourceUri, context.project_id, id, take.extension);
    try {
      const recording = recordingSchema.parse({
        id, displayId, projectId: context.project_id, sessionId, participantId: context.participant_id,
        scenarioId, consentRecordId: currentConsent.id, scenarioVersion: context.scenario_version,
        scenarioPromptSnapshot: {
          title: context.scenario_title,
          description: context.scenario_description,
          collectionInstructions: context.collection_instructions,
          expectedIntent: context.expected_intent,
          collectionMethod: context.collection_method,
          version: context.scenario_version,
          referenceData: context.reference_data_json ? JSON.parse(context.reference_data_json) : null,
        },
        relativeAudioPath: stored.relativePath, collectionMethod: context.collection_method,
        recordedAt: take.recordedAt, durationMs: take.durationMs, fileSizeBytes: stored.size,
        container: take.container, codec: take.codec, sampleRateHz: take.sampleRateHz, channelCount: take.channelCount,
        ...metadata, archivedAt: null, createdAt: timestamp, updatedAt: timestamp,
      });
      await this.db.runAsync(
        `INSERT INTO recordings
         (id, display_id, project_id, session_id, participant_id, scenario_id, consent_record_id, scenario_version,
          scenario_prompt_snapshot_json, relative_audio_path, collection_method, recorded_at, duration_ms, file_size_bytes,
          container, codec, sample_rate_hz, channel_count, spoken_languages_json, language_variety, code_switching_status,
          recording_environment, noise_level, quality_rating, notes, annotation_status, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        recording.id, recording.displayId, recording.projectId, recording.sessionId, recording.participantId,
        recording.scenarioId, recording.consentRecordId, recording.scenarioVersion,
        JSON.stringify(recording.scenarioPromptSnapshot), recording.relativeAudioPath, recording.collectionMethod,
        recording.recordedAt, recording.durationMs, recording.fileSizeBytes, recording.container, recording.codec,
        recording.sampleRateHz, recording.channelCount, JSON.stringify(recording.spokenLanguages), recording.languageVariety,
        recording.codeSwitchingStatus, recording.recordingEnvironment, recording.noiseLevel, recording.qualityRating,
        recording.notes, recording.annotationStatus, recording.archivedAt, recording.createdAt, recording.updatedAt,
      );
      const verified = await this.get(id);
      if (!verified) throw new Error('Recording metadata was not readable after saving.');
      return verified;
    } catch (error) {
      if (stored.file.exists) stored.file.delete();
      throw error;
    }
  }

  async updateStatus(id: string, status: Recording['annotationStatus']): Promise<Recording> {
    const result = await this.db.runAsync('UPDATE recordings SET annotation_status = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL', status, nowIso(), id);
    if (result.changes !== 1) throw new Error('Active recording not found.');
    const recording = await this.get(id);
    if (!recording) throw new Error('Recording was not readable after saving.');
    return recording;
  }

  async archive(id: string): Promise<void> {
    const result = await this.db.runAsync('UPDATE recordings SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL', nowIso(), nowIso(), id);
    if (result.changes !== 1) throw new Error('Active recording not found.');
  }
}
