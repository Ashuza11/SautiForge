import type { SQLiteDatabase } from 'expo-sqlite';

import { newId, nowIso } from '@/domain/common';
import { canRecord, consentDraftSchema, consentRecordSchema, permitsSharing, type ConsentDraft, type ConsentRecord, type SharingCategory } from '../domain/consent';
import type { ConsentRepository } from './consent-repository';

type ConsentRow = {
  id: string;
  participant_id: string;
  status: ConsentRecord['status'];
  internal_research: number;
  restricted_annotation: number;
  public_release: number;
  recorded_by: string | null;
  consented_at: string;
  valid_until: string | null;
  supersedes_id: string | null;
  notes: string | null;
  consent_protocol_version: string;
  created_at: string;
};

const columns = `id, participant_id, status, internal_research, restricted_annotation, public_release,
  recorded_by, consented_at, valid_until, supersedes_id, notes, consent_protocol_version, created_at`;

function fromRow(row: ConsentRow): ConsentRecord {
  return consentRecordSchema.parse({
    id: row.id,
    participantId: row.participant_id,
    status: row.status,
    internalResearch: row.internal_research === 1,
    restrictedAnnotation: row.restricted_annotation === 1,
    publicRelease: row.public_release === 1,
    recordedBy: row.recorded_by,
    consentedAt: row.consented_at,
    validUntil: row.valid_until,
    supersedesId: row.supersedes_id,
    notes: row.notes,
    consentProtocolVersion: row.consent_protocol_version,
    createdAt: row.created_at,
  });
}

export class SQLiteConsentRepository implements ConsentRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async listByParticipant(participantId: string): Promise<ConsentRecord[]> {
    const rows = await this.db.getAllAsync<ConsentRow>(
      `SELECT ${columns} FROM consent_records WHERE participant_id = ? ORDER BY created_at DESC`,
      participantId,
    );
    return rows.map(fromRow);
  }

  async getCurrent(participantId: string): Promise<ConsentRecord | null> {
    const row = await this.db.getFirstAsync<ConsentRow>(
      `SELECT ${columns} FROM consent_records WHERE participant_id = ? ORDER BY created_at DESC LIMIT 1`,
      participantId,
    );
    return row ? fromRow(row) : null;
  }

  async createRevision(participantId: string, input: ConsentDraft): Promise<ConsentRecord> {
    const draft = consentDraftSchema.parse(input);
    const recordId = newId();
    await this.db.withExclusiveTransactionAsync(async (transaction) => {
      const previousRow = await transaction.getFirstAsync<ConsentRow>(
        `SELECT ${columns} FROM consent_records WHERE participant_id = ? ORDER BY created_at DESC LIMIT 1`,
        participantId,
      );
      const timestamp = nowIso();
      const created = consentRecordSchema.parse({
        ...draft,
        id: recordId,
        participantId,
        supersedesId: previousRow?.id ?? null,
        createdAt: timestamp,
      });
      await transaction.runAsync(
        `INSERT INTO consent_records
         (id, participant_id, status, internal_research, restricted_annotation, public_release, recorded_by,
          consented_at, valid_until, supersedes_id, notes, created_at, consent_protocol_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        created.id,
        created.participantId,
        created.status,
        created.internalResearch ? 1 : 0,
        created.restrictedAnnotation ? 1 : 0,
        created.publicRelease ? 1 : 0,
        created.recordedBy,
        created.consentedAt,
        created.validUntil,
        created.supersedesId,
        created.notes,
        created.createdAt,
        created.consentProtocolVersion,
      );
    });
    const verified = await this.db.getFirstAsync<ConsentRow>(`SELECT ${columns} FROM consent_records WHERE id = ?`, recordId);
    if (!verified) throw new Error('Consent record was not readable after saving.');
    return fromRow(verified);
  }

  async participantCanRecord(participantId: string, at = new Date()): Promise<boolean> {
    const participant = await this.db.getFirstAsync<{ status: string }>('SELECT status FROM participants WHERE id = ?', participantId);
    if (participant?.status !== 'active') return false;
    return canRecord(await this.getCurrent(participantId), at);
  }

  async participantPermitsSharing(participantId: string, category: SharingCategory, at = new Date()): Promise<boolean> {
    return permitsSharing(await this.getCurrent(participantId), category, at);
  }
}
