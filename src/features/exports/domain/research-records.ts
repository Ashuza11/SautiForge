import { z } from 'zod';

const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const nullableText = z.string().nullable();
const jsonText = z.string().refine((value) => {
  try { JSON.parse(value); return true; } catch { return false; }
}, 'Must contain valid JSON text');
const nullableJsonText = jsonText.nullable();

export const researchProjectSchema = z.object({
  id, title: z.string().min(1), description: z.string(), target_language: z.string().min(1),
  language_variety: z.string().min(1), research_domain: z.string().min(1), collection_location: z.string().min(1),
  protocol_version: z.string().min(1), status: z.enum(['active', 'archived']), created_at: timestamp, updated_at: timestamp,
}).strict();

export const researchScenarioSchema = z.object({
  id, project_id: id, title: z.string().min(1), description: z.string(), collection_instructions: z.string().min(1),
  expected_intent: z.string().min(1), collection_method: z.string().min(1), version: z.string().min(1),
  reference_data_json: nullableJsonText, status: z.enum(['active', 'archived']), created_at: timestamp, updated_at: timestamp,
}).strict();

export const researchParticipantSchema = z.object({
  id, project_id: id, speaker_code: z.string().min(1), primary_language: z.string().min(1), language_variety: nullableText,
  other_languages_json: jsonText, age_bracket: nullableText, gender_self_described: nullableText, business_category: nullableText,
  years_business_experience: z.number().nonnegative().nullable(), status: z.enum(['active', 'withdrawn', 'archived']),
  created_at: timestamp, updated_at: timestamp,
}).strict();

export const researchSessionSchema = z.object({
  id, project_id: id, participant_id: id, started_at: timestamp, ended_at: timestamp.nullable(), device_metadata_json: jsonText,
  collection_environment: z.string().min(1), city: nullableText, status: z.enum(['in_progress', 'paused', 'completed', 'archived']),
  created_at: timestamp, updated_at: timestamp,
}).strict();

export const researchRecordingSchema = z.object({
  id, display_id: z.string().min(1), project_id: id, session_id: id, participant_id: id, scenario_id: id,
  scenario_version: z.string().min(1), scenario_prompt_snapshot_json: jsonText, collection_method: z.string().min(1),
  recorded_at: timestamp, duration_ms: z.number().int().nonnegative(), file_size_bytes: z.number().int().positive(),
  container: z.string().min(1), codec: nullableText, sample_rate_hz: z.number().int().positive().nullable(),
  channel_count: z.number().int().positive().nullable(), spoken_languages_json: jsonText, language_variety: nullableText,
  code_switching_status: nullableText, recording_environment: nullableText, noise_level: nullableText,
  quality_rating: z.number().int().min(1).max(5).nullable(), notes: nullableText,
  annotation_status: z.enum(['recorded', 'needs_transcription', 'transcribed', 'needs_review', 'validated', 'rejected']),
  created_at: timestamp, updated_at: timestamp,
  audio_path: z.string().regex(/^audio\/[0-9a-f-]{36}\.[a-z0-9]+$/i),
}).strict();

export const researchTranscriptionSchema = z.object({
  id, recording_id: id, verbatim_text: nullableText, normalized_text: nullableText, language_tags_json: jsonText,
  notes: nullableText, source: z.enum(['human', 'automatic']), revision_number: z.number().int().positive(),
  supersedes_id: id.nullable(), created_at: timestamp, created_by: nullableText,
}).strict();

export const researchAnnotationSchema = z.object({
  id, recording_id: id, annotation_type: z.string().min(1), schema_version: z.string().min(1), payload_json: jsonText,
  source: z.enum(['human', 'automatic']), revision_number: z.number().int().positive(), supersedes_id: id.nullable(),
  created_at: timestamp, created_by: nullableText,
}).strict();

export const researchExportRecordsSchema = z.object({
  project: researchProjectSchema,
  scenarios: z.array(researchScenarioSchema),
  participants: z.array(researchParticipantSchema),
  sessions: z.array(researchSessionSchema),
  recordings: z.array(researchRecordingSchema),
  transcriptions: z.array(researchTranscriptionSchema),
  annotations: z.array(researchAnnotationSchema),
}).strict();

export type ResearchExportRecords = z.infer<typeof researchExportRecordsSchema>;
