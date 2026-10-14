import { webcrypto } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';

import { audioMimeType, latestTranscription, loadResearchDataset, matchesRecordingQuery } from './dataset';
import { initialDraft } from './draft';

beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
});

const time = '2026-10-15T08:00:00.000Z';
const projectId = '6a7d8df7-d495-4f69-9934-dc48ce5ee8d1';
const participantId = 'd998bc90-f7d5-4108-900e-aa8951ee7179';
const sessionId = '0d050af7-474d-4ac7-b1e2-f9e05ecbdc79';
const scenarioId = '17f523b2-2db8-4f59-82e9-e70b182656f1';
const recordingId = 'de0a9676-92cc-4b18-997a-3fafce18b700';

describe('browser research dataset import', () => {
  it('verifies a complete export and resolves its recording audio', async () => {
    const archive = await makeArchive();
    const dataset = await loadResearchDataset(asInput('pilot.zip', archive));
    expect(dataset.manifest.exportType).toBe('research_dataset');
    expect(dataset.records.recordings).toHaveLength(1);
    expect(dataset.entries.get(`audio/${recordingId}.opus`)).toBeDefined();
    expect(dataset.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    const recording = dataset.records.recordings[0];
    expect(matchesRecordingQuery(recording, 'SPK-001', 'Recording a sale', 'spk-001')).toBe(true);
    expect(matchesRecordingQuery(recording, 'SPK-001', 'Recording a sale', 'inventory')).toBe(false);
    expect(latestTranscription(dataset, recording.id)).toBeNull();
    expect(audioMimeType(recording.audio_path)).toBe('audio/ogg');
    expect(initialDraft(dataset, recording, new Date(time))).toMatchObject({
      scenarioContext: 'Recording a sale',
      elicitationPromptContext: 'Example',
      languageTags: ['Kingwana'],
      annotationStatus: 'needs_transcription',
      updatedAt: time,
    });
  });

  it('rejects an administrative backup before exposing its contents', async () => {
    const archive = await makeArchive({ exportType: 'administrative_backup', sensitiveAdministrativeData: true });
    await expect(loadResearchDataset(asInput('private.zip', archive))).rejects.toThrow(/not a private administrative backup/);
  });

  it('rejects changed audio, unsafe references and undeclared members', async () => {
    const changedAudio = await makeArchive({}, { audioBytes: strToU8('tampered') });
    await expect(loadResearchDataset(asInput('changed.zip', changedAudio))).rejects.toThrow(/Size mismatch|SHA-256 mismatch/);

    const unsafe = await makeArchive({}, { recordingAudioPath: '../private.opus' });
    await expect(loadResearchDataset(asInput('unsafe.zip', unsafe))).rejects.toThrow(/audio_path|referenced audio|schema/);

    const extra = await makeArchive({}, { extra: { 'private/consent.json': strToU8('{}') } });
    await expect(loadResearchDataset(asInput('extra.zip', extra))).rejects.toThrow(/Undeclared ZIP member/);
  });

  it('rejects a manifest count that does not match the dataset', async () => {
    const archive = await makeArchive({ counts: { recordings: 2, participants: 1, sessions: 1, transcriptions: 0, annotations: 0 } });
    await expect(loadResearchDataset(asInput('count.zip', archive))).rejects.toThrow(/recordings count mismatch/);
  });
});

type ManifestOverrides = Record<string, unknown>;
type ArchiveOverrides = { audioBytes?: Uint8Array; recordingAudioPath?: string; extra?: Record<string, Uint8Array> };

async function makeArchive(manifestOverrides: ManifestOverrides = {}, archiveOverrides: ArchiveOverrides = {}): Promise<Uint8Array> {
  const canonicalAudioPath = `audio/${recordingId}.opus`;
  const audioPath = archiveOverrides.recordingAudioPath ?? canonicalAudioPath;
  const expectedAudio = strToU8('valid opus fixture');
  const entries: Record<string, Uint8Array> = {
    'metadata/project.json': strToU8(JSON.stringify({ id: projectId, title: 'Pilot', description: '', target_language: 'Swahili', language_variety: 'Kingwana', research_domain: 'Business', collection_location: 'Bukavu', protocol_version: '1.0', status: 'active', created_at: time, updated_at: time })),
    'metadata/scenarios.jsonl': line({ id: scenarioId, project_id: projectId, title: 'Recording a sale', description: '', collection_instructions: 'Use fiction.', expected_intent: 'record_sale', collection_method: 'elicited_prompt', version: '1.0', remote_examples_json: '[]', reference_data_json: null, status: 'active', created_at: time, updated_at: time }),
    'metadata/participants.jsonl': line({ id: participantId, project_id: projectId, speaker_code: 'SPK-001', primary_language: 'Kingwana', language_variety: 'Bukavu', other_languages_json: '["French"]', age_bracket: null, gender_self_described: null, business_category: null, years_business_experience: null, status: 'active', created_at: time, updated_at: time }),
    'metadata/sessions.jsonl': line({ id: sessionId, project_id: projectId, participant_id: participantId, started_at: time, ended_at: null, device_metadata_json: '{}', collection_environment: 'Indoor shop', city: 'Bukavu', status: 'completed', created_at: time, updated_at: time }),
    'metadata/recordings.jsonl': line({ id: recordingId, display_id: 'SF-20261015-DE0A9676', project_id: projectId, session_id: sessionId, participant_id: participantId, scenario_id: scenarioId, scenario_version: '1.0', scenario_prompt_snapshot_json: '{}', collection_method: 'elicited_prompt', recorded_at: time, duration_ms: 1000, file_size_bytes: expectedAudio.byteLength, container: 'opus', codec: null, sample_rate_hz: null, channel_count: null, capture_source: 'imported_file', transport: 'whatsapp_manual', prompt_exposure: 'example_shown', imported_at: time, source_mime_type: 'audio/ogg', content_sha256: 'a'.repeat(64), external_submission_id: 'SUB-1', elicitation_prompt_text: 'Example', spoken_languages_json: '["Kingwana"]', language_variety: 'Bukavu', code_switching_status: 'present', recording_environment: 'Indoor shop', noise_level: 'low', quality_rating: 4, notes: null, annotation_status: 'needs_transcription', created_at: time, updated_at: time, audio_path: audioPath }),
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
    schemaVersion: '1.3.0', exportId: 'e0a3a433-9c63-4dcb-b7cd-72d87dc54c79', exportType: 'research_dataset', exportedAt: time,
    app: 'SautiForge', databaseVersion: 7, projectId, sharingCategory: 'restricted_annotation', sensitiveAdministrativeData: false,
    counts: { recordings: 1, participants: 1, sessions: 1, transcriptions: 0, annotations: 0 }, files,
    ...manifestOverrides,
  };
  entries['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(entries);
}

function line(value: unknown): Uint8Array { return strToU8(`${JSON.stringify(value)}\n`); }
function asInput(name: string, bytes: Uint8Array) { return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }; }
async function hash(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await webcrypto.subtle.digest('SHA-256', source);
  return Buffer.from(digest).toString('hex');
}
