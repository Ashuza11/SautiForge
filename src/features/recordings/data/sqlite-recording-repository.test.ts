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
});

describe('accepted recording persistence', () => {
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
