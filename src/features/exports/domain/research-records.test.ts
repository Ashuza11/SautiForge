import { describe, expect, it } from 'vitest';

import { researchExportRecordsSchema, researchParticipantSchema, researchRecordingSchema, researchTranscriptionSchema } from './research-records';

const time = '2026-09-23T08:00:00.000Z';
const projectId = '6a7d8df7-d495-4f69-9934-dc48ce5ee8d1';
const participantId = 'd998bc90-f7d5-4108-900e-aa8951ee7179';
const recordingId = 'de0a9676-92cc-4b18-997a-3fafce18b700';

const participant = {
  id: participantId, project_id: projectId, speaker_code: 'SPK-001', primary_language: 'Kingwana', language_variety: 'Bukavu',
  other_languages_json: '["French"]', age_bracket: null, gender_self_described: null, business_category: 'Retail',
  years_business_experience: 4, status: 'active' as const, created_at: time, updated_at: time,
};

const recording = {
  id: recordingId, display_id: 'SF-20260923-DE0A9676', project_id: projectId,
  session_id: '0d050af7-474d-4ac7-b1e2-f9e05ecbdc79', participant_id: participantId,
  scenario_id: '17f523b2-2db8-4f59-82e9-e70b182656f1', scenario_version: '1.0', scenario_prompt_snapshot_json: '{}',
  collection_method: 'elicited_prompt', recorded_at: time, duration_ms: 1200, file_size_bytes: 42,
  container: 'm4a', codec: 'aac', sample_rate_hz: 44100, channel_count: 2, spoken_languages_json: '["Kingwana"]',
  capture_source: 'device_microphone' as const, transport: null, prompt_exposure: 'instructions_only' as const,
  imported_at: null, source_mime_type: 'audio/mp4', content_sha256: null, external_submission_id: null,
  elicitation_prompt_text: null,
  language_variety: 'Bukavu', code_switching_status: 'none', recording_environment: 'Indoor shop', noise_level: 'low',
  quality_rating: 4, notes: null, annotation_status: 'needs_transcription' as const, created_at: time, updated_at: time,
  audio_path: `audio/${recordingId}.m4a`,
};

describe('research export record contracts', () => {
  it('accepts a complete, privacy-minimized record set', () => {
    const parsed = researchExportRecordsSchema.parse({
      project: { id: projectId, title: 'Pilot', description: '', target_language: 'Swahili', language_variety: 'Kingwana', research_domain: 'Business', collection_location: 'Bukavu', protocol_version: '1.0', status: 'active', created_at: time, updated_at: time },
      scenarios: [], participants: [participant], sessions: [], recordings: [recording], transcriptions: [], annotations: [],
    });
    expect(parsed.recordings[0].audio_path).toBe(`audio/${recordingId}.m4a`);
    expect(parsed.project).toMatchObject({ language_code: 'und', annotation_profile: 'business_transaction' });
  });

  it('preserves reusable language and annotation configuration', () => {
    const parsed = researchExportRecordsSchema.parse({
      project: { id: projectId, title: 'Mashi pilot', description: '', target_language: 'Shi', language_code: 'shr', language_variety: 'Mashi', research_domain: 'General speech', collection_location: 'South Kivu', protocol_version: '0.2', annotation_profile: 'verbatim_transcription', status: 'active', created_at: time, updated_at: time },
      scenarios: [], participants: [participant], sessions: [], recordings: [recording], transcriptions: [], annotations: [],
    });
    expect(parsed.project).toMatchObject({ language_code: 'shr', annotation_profile: 'verbatim_transcription' });
  });

  it('rejects administrative participant fields from research exports', () => {
    expect(researchParticipantSchema.safeParse({ ...participant, research_notes: 'private' }).success).toBe(false);
    expect(researchParticipantSchema.safeParse({ ...participant, consent_status: 'granted' }).success).toBe(false);
  });

  it('rejects malformed JSON and unsafe audio references', () => {
    expect(researchParticipantSchema.safeParse({ ...participant, other_languages_json: 'not-json' }).success).toBe(false);
    expect(researchRecordingSchema.safeParse({ ...recording, audio_path: '../private/audio.m4a' }).success).toBe(false);
  });

  it('preserves batch-import prompt provenance without exporting the provider filename', () => {
    const parsed = researchRecordingSchema.parse({
      ...recording,
      capture_source: 'imported_file',
      transport: 'whatsapp_manual',
      prompt_exposure: 'example_shown',
      imported_at: time,
      content_sha256: 'a'.repeat(64),
      external_submission_id: 'SUB-BATCH01',
      elicitation_prompt_text: 'Mfano wa kwanza',
    });
    expect(parsed.elicitation_prompt_text).toBe('Mfano wa kwanza');
    expect(researchRecordingSchema.safeParse({ ...parsed, source_file_name: 'private-provider-name.opus' }).success).toBe(false);
  });

  it('exports the editable transcription context with its revision', () => {
    const parsed = researchTranscriptionSchema.parse({
      id: 'f113147b-c726-444c-a454-94f0ee1d1b6c',
      recording_id: recordingId,
      verbatim_text: 'Nimeuzisha unités mbili',
      normalized_text: null,
      scenario_context: 'Recording a sale',
      elicitation_prompt_context: 'Uuzishe unités mbili',
      language_tags_json: '["kingwana"]',
      notes: null,
      source: 'human',
      revision_number: 1,
      supersedes_id: null,
      created_at: time,
      created_by: null,
    });
    expect(parsed.scenario_context).toBe('Recording a sale');
    expect(parsed.elicitation_prompt_context).toBe('Uuzishe unités mbili');
  });
});
