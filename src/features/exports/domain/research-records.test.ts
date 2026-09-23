import { describe, expect, it } from 'vitest';

import { researchExportRecordsSchema, researchParticipantSchema, researchRecordingSchema } from './research-records';

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
  language_variety: 'Bukavu', code_switching_status: 'none', recording_environment: 'Indoor shop', noise_level: 'low',
  quality_rating: 4, notes: null, annotation_status: 'needs_transcription' as const, created_at: time, updated_at: time,
  audio_path: `audio/${recordingId}.m4a`,
};

describe('research export record contracts', () => {
  it('accepts a complete, privacy-minimized record set', () => {
    expect(researchExportRecordsSchema.parse({
      project: { id: projectId, title: 'Pilot', description: '', target_language: 'Swahili', language_variety: 'Kingwana', research_domain: 'Business', collection_location: 'Bukavu', protocol_version: '1.0', status: 'active', created_at: time, updated_at: time },
      scenarios: [], participants: [participant], sessions: [], recordings: [recording], transcriptions: [], annotations: [],
    }).recordings[0].audio_path).toBe(`audio/${recordingId}.m4a`);
  });

  it('rejects administrative participant fields from research exports', () => {
    expect(researchParticipantSchema.safeParse({ ...participant, research_notes: 'private' }).success).toBe(false);
    expect(researchParticipantSchema.safeParse({ ...participant, consent_status: 'granted' }).success).toBe(false);
  });

  it('rejects malformed JSON and unsafe audio references', () => {
    expect(researchParticipantSchema.safeParse({ ...participant, other_languages_json: 'not-json' }).success).toBe(false);
    expect(researchRecordingSchema.safeParse({ ...recording, audio_path: '../private/audio.m4a' }).success).toBe(false);
  });
});
