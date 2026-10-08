import { describe, expect, it, vi } from 'vitest';

import { SQLiteParticipantRepository } from './sqlite-participant-repository';

vi.mock('@/domain/common', () => ({
  newId: vi.fn(),
  nowIso: vi.fn(),
}));

describe('participant progress repository', () => {
  it('derives scenario targets and current human transcription progress from active records', async () => {
    const getAllAsync = vi.fn()
      .mockResolvedValueOnce([{ id: 'speaker' }])
      .mockResolvedValueOnce([
        { id: 'sale', remote_examples_json: JSON.stringify(['one', 'two']) },
        { id: 'debt', remote_examples_json: '[]' },
      ])
      .mockResolvedValueOnce([
        { id: 'recording-one', participant_id: 'speaker', scenario_id: 'sale', transcribed: 1 },
        { id: 'recording-two', participant_id: 'speaker', scenario_id: 'sale', transcribed: 1 },
        { id: 'recording-three', participant_id: 'speaker', scenario_id: 'debt', transcribed: 0 },
      ]);
    const repository = new SQLiteParticipantRepository({ getAllAsync } as never);

    await expect(repository.getProgressByProject('project')).resolves.toEqual({
      speaker: {
        requiredRecordingCount: 3,
        recordingCount: 3,
        transcribedRecordingCount: 2,
        collectionComplete: true,
        transcriptionComplete: false,
      },
    });
    expect(getAllAsync).toHaveBeenCalledTimes(3);
    expect(getAllAsync.mock.calls[2][0]).toContain("r.archived_at IS NULL AND r.annotation_status <> 'rejected'");
    expect(getAllAsync.mock.calls[2][0]).toContain("t.source = 'human'");
  });
});
