import { webcrypto } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';

export const fixtureTime = '2026-10-15T08:00:00.000Z';
export const fixtureProjectId = '6a7d8df7-d495-4f69-9934-dc48ce5ee8d1';
export const fixtureParticipantId = 'd998bc90-f7d5-4108-900e-aa8951ee7179';
export const fixtureSessionId = '0d050af7-474d-4ac7-b1e2-f9e05ecbdc79';
export const fixtureScenarioId = '17f523b2-2db8-4f59-82e9-e70b182656f1';
export const fixtureRecordingId = 'de0a9676-92cc-4b18-997a-3fafce18b700';

type ManifestOverrides = Record<string, unknown>;
type ArchiveOverrides = {
  audioBytes?: Uint8Array;
  recordingAudioPath?: string;
  project?: Record<string, unknown>;
  extra?: Record<string, Uint8Array>;
};

export async function makeResearchArchive(manifestOverrides: ManifestOverrides = {}, archiveOverrides: ArchiveOverrides = {}): Promise<Uint8Array> {
  const canonicalAudioPath = `audio/${fixtureRecordingId}.opus`;
  const audioPath = archiveOverrides.recordingAudioPath ?? canonicalAudioPath;
  const expectedAudio = strToU8('valid opus fixture');
  const entries: Record<string, Uint8Array> = {
    'metadata/project.json': strToU8(JSON.stringify({ id: fixtureProjectId, title: 'Pilot', description: '', target_language: 'Swahili', language_variety: 'Kingwana', research_domain: 'Business', collection_location: 'Bukavu', protocol_version: '1.0', status: 'active', created_at: fixtureTime, updated_at: fixtureTime, ...archiveOverrides.project })),
    'metadata/scenarios.jsonl': line({ id: fixtureScenarioId, project_id: fixtureProjectId, title: 'Recording a sale', description: '', collection_instructions: 'Use fiction.', expected_intent: 'record_sale', collection_method: 'elicited_prompt', version: '1.0', remote_examples_json: '[]', reference_data_json: null, status: 'active', created_at: fixtureTime, updated_at: fixtureTime }),
    'metadata/participants.jsonl': line({ id: fixtureParticipantId, project_id: fixtureProjectId, speaker_code: 'SPK-001', primary_language: 'Kingwana', language_variety: 'Bukavu', other_languages_json: '["French"]', age_bracket: null, gender_self_described: null, business_category: null, years_business_experience: null, status: 'active', created_at: fixtureTime, updated_at: fixtureTime }),
    'metadata/sessions.jsonl': line({ id: fixtureSessionId, project_id: fixtureProjectId, participant_id: fixtureParticipantId, started_at: fixtureTime, ended_at: null, device_metadata_json: '{}', collection_environment: 'Indoor shop', city: 'Bukavu', status: 'completed', created_at: fixtureTime, updated_at: fixtureTime }),
    'metadata/recordings.jsonl': line({ id: fixtureRecordingId, display_id: 'SF-20261015-DE0A9676', project_id: fixtureProjectId, session_id: fixtureSessionId, participant_id: fixtureParticipantId, scenario_id: fixtureScenarioId, scenario_version: '1.0', scenario_prompt_snapshot_json: '{}', collection_method: 'elicited_prompt', recorded_at: fixtureTime, duration_ms: 1000, file_size_bytes: expectedAudio.byteLength, container: 'opus', codec: null, sample_rate_hz: null, channel_count: null, capture_source: 'imported_file', transport: 'whatsapp_manual', prompt_exposure: 'example_shown', imported_at: fixtureTime, source_mime_type: 'audio/ogg', content_sha256: 'a'.repeat(64), external_submission_id: 'SUB-1', elicitation_prompt_text: 'Example', spoken_languages_json: '["Kingwana"]', language_variety: 'Bukavu', code_switching_status: 'present', recording_environment: 'Indoor shop', noise_level: 'low', quality_rating: 4, notes: null, annotation_status: 'needs_transcription', created_at: fixtureTime, updated_at: fixtureTime, audio_path: audioPath }),
    'metadata/transcriptions.jsonl': new Uint8Array(),
    'metadata/annotations.jsonl': new Uint8Array(),
    [canonicalAudioPath]: archiveOverrides.audioBytes ?? expectedAudio,
    ...archiveOverrides.extra,
  };
  const files = await Promise.all(Object.entries(entries).filter(([path]) => path !== 'manifest.json' && !archiveOverrides.extra?.[path]).map(async ([path, bytes]) => {
    const declaredBytes = path === canonicalAudioPath && archiveOverrides.audioBytes ? expectedAudio : bytes;
    return { path, sizeBytes: declaredBytes.byteLength, sha256: await hash(declaredBytes) };
  }));
  const manifest = {
    schemaVersion: '1.3.0', exportId: 'e0a3a433-9c63-4dcb-b7cd-72d87dc54c79', exportType: 'research_dataset', exportedAt: fixtureTime,
    app: 'SautiForge', databaseVersion: 7, projectId: fixtureProjectId, sharingCategory: 'restricted_annotation', sensitiveAdministrativeData: false,
    counts: { recordings: 1, participants: 1, sessions: 1, transcriptions: 0, annotations: 0 }, files,
    ...manifestOverrides,
  };
  entries['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(entries);
}

export function archiveInput(name: string, bytes: Uint8Array) {
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
}

function line(value: unknown): Uint8Array { return strToU8(`${JSON.stringify(value)}\n`); }

async function hash(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await webcrypto.subtle.digest('SHA-256', source);
  return Buffer.from(digest).toString('hex');
}
