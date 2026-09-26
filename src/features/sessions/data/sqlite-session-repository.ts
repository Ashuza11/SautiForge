import type { SQLiteDatabase } from 'expo-sqlite';

import { newId, nowIso } from '@/domain/common';
import type { ConsentRepository } from '@/features/consent/data/consent-repository';
import { sessionDraftSchema, sessionSchema, type CollectionSession, type SessionDraft } from '../domain/session';
import { requireCompletedSessionForReopen } from '../domain/session-transition';
import type { SessionRepository } from './session-repository';

type SessionRow = {
  id: string;
  project_id: string;
  participant_id: string;
  consent_record_id: string | null;
  started_at: string;
  ended_at: string | null;
  device_metadata_json: string;
  collection_environment: string;
  city: string | null;
  researcher_notes: string | null;
  status: CollectionSession['status'];
  created_at: string;
  updated_at: string;
};

const columns = `id, project_id, participant_id, consent_record_id, started_at, ended_at, device_metadata_json,
  collection_environment, city, researcher_notes, status, created_at, updated_at`;

function fromRow(row: SessionRow): CollectionSession {
  if (!row.consent_record_id) throw new Error('This legacy session has no linked consent record and cannot be resumed.');
  return sessionSchema.parse({
    id: row.id,
    projectId: row.project_id,
    participantId: row.participant_id,
    consentRecordId: row.consent_record_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    deviceMetadata: JSON.parse(row.device_metadata_json),
    collectionEnvironment: row.collection_environment,
    city: row.city,
    researcherNotes: row.researcher_notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class SQLiteSessionRepository implements SessionRepository {
  constructor(private readonly db: SQLiteDatabase, private readonly consent: ConsentRepository) {}

  async listByParticipant(participantId: string): Promise<CollectionSession[]> {
    const rows = await this.db.getAllAsync<SessionRow>(
      `SELECT ${columns} FROM sessions WHERE participant_id = ? ORDER BY started_at DESC`,
      participantId,
    );
    return rows.map(fromRow);
  }

  async get(id: string): Promise<CollectionSession | null> {
    const row = await this.db.getFirstAsync<SessionRow>(`SELECT ${columns} FROM sessions WHERE id = ?`, id);
    return row ? fromRow(row) : null;
  }

  async create(projectId: string, participantId: string, input: SessionDraft): Promise<CollectionSession> {
    const draft = sessionDraftSchema.parse(input);
    const participant = await this.db.getFirstAsync<{ project_id: string; status: string }>(
      'SELECT project_id, status FROM participants WHERE id = ?', participantId,
    );
    if (!participant || participant.project_id !== projectId || participant.status !== 'active') {
      throw new Error('An active participant in this project is required.');
    }
    if (!(await this.consent.participantCanRecord(participantId))) {
      throw new Error('Valid internal-research recording consent is required before starting a session.');
    }
    const currentConsent = await this.consent.getCurrent(participantId);
    if (!currentConsent) throw new Error('The authorizing consent record could not be loaded.');
    const timestamp = nowIso();
    const session = sessionSchema.parse({
      ...draft,
      id: newId(),
      projectId,
      participantId,
      consentRecordId: currentConsent.id,
      startedAt: timestamp,
      endedAt: null,
      status: 'in_progress',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.db.runAsync(
      `INSERT INTO sessions
       (id, project_id, participant_id, consent_record_id, started_at, ended_at, device_metadata_json,
        collection_environment, city, researcher_notes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      session.id,
      session.projectId,
      session.participantId,
      session.consentRecordId,
      session.startedAt,
      session.endedAt,
      JSON.stringify(session.deviceMetadata),
      session.collectionEnvironment,
      session.city,
      session.researcherNotes,
      session.status,
      session.createdAt,
      session.updatedAt,
    );
    const verified = await this.get(session.id);
    if (!verified) throw new Error('Session was not readable after saving.');
    return verified;
  }

  async resume(id: string): Promise<CollectionSession> {
    const session = await this.get(id);
    if (!session || !['paused', 'in_progress'].includes(session.status)) throw new Error('Only an unfinished session can be resumed.');
    if (!(await this.consent.participantCanRecord(session.participantId))) {
      throw new Error('Current recording consent is not valid. Review consent before resuming.');
    }
    await this.db.runAsync(`UPDATE sessions SET status = 'in_progress', ended_at = NULL, updated_at = ? WHERE id = ?`, nowIso(), id);
    const updated = await this.get(id);
    if (!updated) throw new Error('Session was not readable after resuming.');
    return updated;
  }

  async reopen(id: string): Promise<CollectionSession> {
    const session = await this.get(id);
    if (!session) throw new Error('Session not found.');
    requireCompletedSessionForReopen(session.status);
    if (!(await this.consent.participantCanRecord(session.participantId))) {
      throw new Error('Current recording consent is not valid. Review consent before reopening.');
    }
    const result = await this.db.runAsync(
      `UPDATE sessions SET status = 'in_progress', ended_at = NULL, updated_at = ? WHERE id = ? AND status = 'completed'`,
      nowIso(),
      id,
    );
    if (result.changes !== 1) throw new Error('The completed session could not be reopened.');
    const updated = await this.get(id);
    if (!updated || updated.status !== 'in_progress' || updated.endedAt !== null) {
      throw new Error('The reopened session was not readable after saving.');
    }
    return updated;
  }

  async pause(id: string): Promise<CollectionSession> {
    return this.setState(id, 'paused', null);
  }

  async complete(id: string): Promise<CollectionSession> {
    return this.setState(id, 'completed', nowIso());
  }

  private async setState(id: string, status: 'paused' | 'completed', endedAt: string | null): Promise<CollectionSession> {
    const result = await this.db.runAsync(
      `UPDATE sessions SET status = ?, ended_at = ?, updated_at = ? WHERE id = ? AND status IN ('in_progress', 'paused')`,
      status,
      endedAt,
      nowIso(),
      id,
    );
    if (result.changes !== 1) throw new Error('Unfinished session not found.');
    const updated = await this.get(id);
    if (!updated) throw new Error('Session was not readable after saving.');
    return updated;
  }
}
