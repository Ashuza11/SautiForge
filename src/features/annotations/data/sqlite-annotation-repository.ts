import type { SQLiteDatabase } from 'expo-sqlite';

import { newId, nowIso } from '@/domain/common';
import { annotationSchema, businessAnnotationPayloadSchema, type Annotation, type BusinessAnnotationPayload } from '../domain/annotation';
import type { AnnotationRepository } from './annotation-repository';

const BUSINESS_TYPE = 'business.transaction';
const BUSINESS_SCHEMA_VERSION = '1.0';
type Row = { id: string; recording_id: string; annotation_type: string; schema_version: string; payload_json: string; source: Annotation['source']; revision_number: number; supersedes_id: string | null; created_at: string; created_by: string | null };
const columns = 'id, recording_id, annotation_type, schema_version, payload_json, source, revision_number, supersedes_id, created_at, created_by';
const fromRow = (row: Row): Annotation => annotationSchema.parse({ id: row.id, recordingId: row.recording_id, annotationType: row.annotation_type, schemaVersion: row.schema_version, payload: JSON.parse(row.payload_json), source: row.source, revisionNumber: row.revision_number, supersedesId: row.supersedes_id, createdAt: row.created_at, createdBy: row.created_by });

export class SQLiteAnnotationRepository implements AnnotationRepository {
  constructor(private readonly db: SQLiteDatabase) {}
  async listRevisions(recordingId: string, annotationType: string): Promise<Annotation[]> {
    return (await this.db.getAllAsync<Row>(`SELECT ${columns} FROM annotations WHERE recording_id = ? AND annotation_type = ? ORDER BY revision_number DESC`, recordingId, annotationType)).map(fromRow);
  }
  async getCurrentBusiness(recordingId: string): Promise<Annotation | null> {
    const row = await this.db.getFirstAsync<Row>(`SELECT ${columns} FROM annotations WHERE recording_id = ? AND annotation_type = ? ORDER BY revision_number DESC LIMIT 1`, recordingId, BUSINESS_TYPE);
    return row ? fromRow(row) : null;
  }
  async createBusinessRevision(recordingId: string, input: BusinessAnnotationPayload, createdBy: string | null): Promise<Annotation> {
    const payload = businessAnnotationPayloadSchema.parse(input);
    const id = newId();
    await this.db.withExclusiveTransactionAsync(async (transaction) => {
      const previous = await transaction.getFirstAsync<Row>(`SELECT ${columns} FROM annotations WHERE recording_id = ? AND annotation_type = ? ORDER BY revision_number DESC LIMIT 1`, recordingId, BUSINESS_TYPE);
      const annotation = annotationSchema.parse({ id, recordingId, annotationType: BUSINESS_TYPE, schemaVersion: BUSINESS_SCHEMA_VERSION, payload, source: 'human', revisionNumber: (previous?.revision_number ?? 0) + 1, supersedesId: previous?.id ?? null, createdAt: nowIso(), createdBy });
      await transaction.runAsync(`INSERT INTO annotations (id, recording_id, annotation_type, schema_version, payload_json, source, revision_number, supersedes_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, annotation.id, annotation.recordingId, annotation.annotationType, annotation.schemaVersion, JSON.stringify(annotation.payload), annotation.source, annotation.revisionNumber, annotation.supersedesId, annotation.createdAt, annotation.createdBy);
    });
    const saved = await this.db.getFirstAsync<Row>(`SELECT ${columns} FROM annotations WHERE id = ?`, id);
    if (!saved) throw new Error('Annotation revision was not readable after saving.');
    return fromRow(saved);
  }
}
