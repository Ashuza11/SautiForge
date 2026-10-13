import { beforeEach, describe, expect, it, vi } from 'vitest';

import { copyAcceptedTake } from './audio-file-store';
import { buildRecordingSearchWhere } from './recording-search';
import { SQLiteRecordingRepository } from './sqlite-recording-repository';

vi.mock('@/domain/common', () => ({
  newId: () => 'de0a9676-92cc-4b18-997a-3fafce18b700',
  nowIso: () => '2026-09-24T10:00:00.000+02:00',
}));

vi.mock('./audio-file-store', () => ({ copyAcceptedTake: vi.fn() }));

const context = {
  session_id: '7a2c5300-f90d-49b6-8592-348787011e0f',
  project_id: 'f75fb042-bd31-4f16-a1b7-26ab4764e817',
  participant_id: '4a63d3ed-5016-4512-91e2-36342d412f19',
  session_status: 'in_progress',
  scenario_id: '3f783977-0bb2-419a-a8a2-615184cf810b',
  scenario_project_id: 'f75fb042-bd31-4f16-a1b7-26ab4764e817',
  scenario_title: 'Recording a sale',
  scenario_description: 'Fictional sale',
  collection_instructions: 'Describe a sanitized sale.',
  expected_intent: 'record_sale',
  collection_method: 'elicited',
  scenario_version: '1.0.0',
  reference_data_json: null,
  remote_examples_json: '[]',
};

const take = {
  sourceUri: 'file:///cache/take.m4a',
  durationMs: 1200,
  recordedAt: '2026-09-24T09:59:00.000+02:00',
  extension: '.m4a',
  container: 'm4a',
  codec: 'aac',
  sampleRateHz: 44100,
  channelCount: 2,
  captureSource: 'device_microphone' as const,
  transport: null,
  promptExposure: 'instructions_only' as const,
  importedAt: null,
  sourceMimeType: 'audio/mp4',
  contentSha256: null,
  externalSubmissionId: null,
  elicitationPromptText: null,
  sourceFileName: null,
};

const metadata = {
  spokenLanguages: ['Kingwana'],
  languageVariety: 'Bukavu',
  codeSwitchingStatus: 'none',
  recordingEnvironment: 'Indoor shop',
  noiseLevel: 'low',
  qualityRating: 4,
  notes: null,
  annotationStatus: 'needs_transcription' as const,
};

const importedRecordingRow = {
  id: '0d050af7-474d-4ac7-b1e2-f9e05ecbdc79',
  display_id: 'SF-20260924-0D050AF7',
  project_id: context.project_id,
  session_id: context.session_id,
  participant_id: context.participant_id,
  scenario_id: context.scenario_id,
  consent_record_id: 'e8047f61-d626-4b05-b163-48346bc6aecb',
  scenario_version: '1.0.0',
  scenario_prompt_snapshot_json: JSON.stringify({ title: 'Recording a sale', remoteExamples: ['Example one', 'Example two'] }),
  relative_audio_path: 'recordings/project/imported.opus',
  collection_method: 'elicited_prompt',
  recorded_at: '2026-09-24T09:59:00.000+02:00',
  duration_ms: 1200,
  file_size_bytes: 2048,
  container: 'ogg',
  codec: 'opus',
  sample_rate_hz: 48000,
  channel_count: 1,
  spoken_languages_json: '["Kingwana"]',
  language_variety: 'Bukavu',
  code_switching_status: 'none',
  recording_environment: 'Indoor shop',
  noise_level: 'low',
  quality_rating: 4,
  notes: null,
  annotation_status: 'needs_transcription',
  archived_at: null,
  created_at: '2026-09-24T09:59:00.000+02:00',
  updated_at: '2026-09-24T09:59:00.000+02:00',
  capture_source: 'imported_file',
  transport: 'whatsapp_manual',
  prompt_exposure: 'example_shown',
  imported_at: '2026-09-24T09:59:00.000+02:00',
  source_mime_type: 'audio/ogg',
  content_sha256: 'a'.repeat(64),
  external_submission_id: 'SUB-ABC123',
  elicitation_prompt_text: 'Example one',
  source_file_name: 'voice-note.opus',
};

function repositoryFor(runAsync: ReturnType<typeof vi.fn>) {
  const getFirstAsync = vi.fn().mockResolvedValueOnce(context).mockResolvedValueOnce(null);
  const db = { getFirstAsync, runAsync };
  const consent = {
    participantCanRecord: vi.fn().mockResolvedValue(true),
    getCurrent: vi.fn().mockResolvedValue({ id: 'e8047f61-d626-4b05-b163-48346bc6aecb' }),
  };
  return new SQLiteRecordingRepository(db as never, consent as never);
}

beforeEach(() => vi.clearAllMocks());

describe('recording library query', () => {
  it('builds all required filters with bound parameters', () => {
    const result = buildRecordingSearchWhere({
      projectId: 'project', participantId: 'participant', scenarioId: 'scenario', query: 'sale',
      annotationStatus: 'needs_review', language: ' Kingwana ', qualityRating: 4,
      recordedFrom: '2026-09-01', recordedTo: '2026-09-23',
    });
    expect(result.clause).toContain('r.project_id = ?');
    expect(result.clause).toContain('r.participant_id = ?');
    expect(result.clause).toContain('r.scenario_id = ?');
    expect(result.clause).toContain('r.recorded_at >= ?');
    expect(result.clause).toContain('r.recorded_at <= ?');
    expect(result.parameters).toEqual([
      'project', 'participant', 'scenario', 'needs_review', '%Kingwana%', 4,
      '2026-09-01T00:00:00.000Z', '2026-09-23T23:59:59.999Z', '%sale%', '%sale%', '%sale%', '%sale%',
    ]);
  });

  it('always excludes soft-archived recordings', () => {
    expect(buildRecordingSearchWhere({}).clause).toBe('r.archived_at IS NULL');
  });

  it('soft-archives a recording so its audio remains recoverable', async () => {
    const runAsync = vi.fn().mockResolvedValue({ changes: 1 });
    const repository = new SQLiteRecordingRepository(
      { runAsync } as never,
      {} as never,
    );

    await expect(repository.archive('recording-id')).resolves.toBeUndefined();
    expect(runAsync).toHaveBeenCalledWith(
      'UPDATE recordings SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL',
      '2026-09-24T10:00:00.000+02:00',
      '2026-09-24T10:00:00.000+02:00',
      'recording-id',
    );
  });
});

describe('accepted recording persistence', () => {
  it('rejects an active duplicate import before copying it into permanent storage', async () => {
    const duplicateHash = 'a'.repeat(64);
    const getFirstAsync = vi.fn()
      .mockResolvedValueOnce(context)
      .mockResolvedValueOnce({ display_id: 'SF-EXISTING' });
    const db = { getFirstAsync, runAsync: vi.fn() };
    const consent = {
      participantCanRecord: vi.fn().mockResolvedValue(true),
      getCurrent: vi.fn().mockResolvedValue({ id: 'e8047f61-d626-4b05-b163-48346bc6aecb' }),
    };
    const repository = new SQLiteRecordingRepository(db as never, consent as never);

    await expect(repository.saveAcceptedTake(context.session_id, context.scenario_id, {
      ...take,
      captureSource: 'imported_file',
      transport: 'whatsapp_manual',
      importedAt: '2026-09-24T09:59:30.000+02:00',
      contentSha256: duplicateHash,
      externalSubmissionId: 'SUB-ABC123',
      elicitationPromptText: null,
      sourceFileName: 'voice-note.ogg',
    }, metadata)).rejects.toThrow('already saved as SF-EXISTING');

    expect(copyAcceptedTake).not.toHaveBeenCalled();
  });

  it('removes inserted metadata before deleting audio when post-save verification fails', async () => {
    const removeAudio = vi.fn();
    vi.mocked(copyAcceptedTake).mockResolvedValue({
      relativePath: 'recordings/project/recording.m4a',
      size: 2048,
      file: { exists: true, delete: removeAudio },
    } as never);
    const runAsync = vi.fn().mockResolvedValue({ changes: 1 });

    await expect(repositoryFor(runAsync).saveAcceptedTake(context.session_id, context.scenario_id, take, metadata))
      .rejects.toThrow('Recording metadata was not readable after saving.');

    expect(runAsync).toHaveBeenCalledTimes(2);
    expect(runAsync.mock.calls[1]).toEqual(['DELETE FROM recordings WHERE id = ?', 'de0a9676-92cc-4b18-997a-3fafce18b700']);
    expect(removeAudio).toHaveBeenCalledOnce();
  });

  it('retains verified audio when database compensation fails', async () => {
    const removeAudio = vi.fn();
    vi.mocked(copyAcceptedTake).mockResolvedValue({
      relativePath: 'recordings/project/recording.m4a',
      size: 2048,
      file: { exists: true, delete: removeAudio },
    } as never);
    const runAsync = vi.fn()
      .mockResolvedValueOnce({ changes: 1 })
      .mockRejectedValueOnce(new Error('database locked'));

    await expect(repositoryFor(runAsync).saveAcceptedTake(context.session_id, context.scenario_id, take, metadata))
      .rejects.toThrow(/audio was retained for recovery.*database locked/i);
    expect(removeAudio).not.toHaveBeenCalled();
  });
});

describe('saved example correction', () => {
  it('atomically stores an audit revision, updates the current association, and verifies it', async () => {
    const correctedRow = { ...importedRecordingRow, elicitation_prompt_text: 'Example two', updated_at: '2026-09-24T10:00:00.000+02:00' };
    const transaction = {
      getFirstAsync: vi.fn().mockResolvedValueOnce(importedRecordingRow).mockResolvedValueOnce(correctedRow),
      runAsync: vi.fn().mockResolvedValue({ changes: 1 }),
    };
    const db = {
      withExclusiveTransactionAsync: vi.fn(async (operation) => operation(transaction)),
    };
    const repository = new SQLiteRecordingRepository(db as never, {} as never);

    const result = await repository.correctElicitationPrompt(importedRecordingRow.id, {
      correctedPromptText: 'Example two',
      reason: 'Selected the adjacent example during import.',
      correctedBy: 'RES-01',
    });

    expect(result.elicitationPromptText).toBe('Example two');
    expect(transaction.runAsync).toHaveBeenCalledTimes(2);
    expect(String(transaction.runAsync.mock.calls[0]?.[0])).toContain('INSERT INTO recording_prompt_corrections');
    expect(String(transaction.runAsync.mock.calls[1]?.[0])).toContain('UPDATE recordings SET elicitation_prompt_text');
  });

  it('rejects an example that was not part of the stored scenario version', async () => {
    const transaction = {
      getFirstAsync: vi.fn().mockResolvedValue(importedRecordingRow),
      runAsync: vi.fn(),
    };
    const db = { withExclusiveTransactionAsync: vi.fn(async (operation) => operation(transaction)) };
    const repository = new SQLiteRecordingRepository(db as never, {} as never);

    await expect(repository.correctElicitationPrompt(importedRecordingRow.id, {
      correctedPromptText: 'A later edited example',
      reason: 'Testing invalid provenance.',
      correctedBy: null,
    })).rejects.toThrow(/scenario version stored/);
    expect(transaction.runAsync).not.toHaveBeenCalled();
  });

  it('returns validated correction history in newest-first query order', async () => {
    const db = { getAllAsync: vi.fn().mockResolvedValue([{
      id: 'de0a9676-92cc-4b18-997a-3fafce18b700',
      recording_id: importedRecordingRow.id,
      previous_prompt_text: 'Example one',
      corrected_prompt_text: 'Example two',
      reason: 'Wrong selection.',
      corrected_by: 'RES-01',
      created_at: '2026-09-24T10:00:00.000+02:00',
    }]) };
    const repository = new SQLiteRecordingRepository(db as never, {} as never);

    await expect(repository.listPromptCorrections(importedRecordingRow.id)).resolves.toMatchObject([
      { previousPromptText: 'Example one', correctedPromptText: 'Example two', correctedBy: 'RES-01' },
    ]);
    expect(String(db.getAllAsync.mock.calls[0]?.[0])).toContain('ORDER BY created_at DESC');
  });
});
