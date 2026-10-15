import { describe, expect, it } from 'vitest';

import { firstIncompleteRecording, participantAnnotationProgress } from './annotation-workflow';

describe('participant annotation workflow', () => {
  it('marks a speaker complete only when every recording has a verbatim transcript', () => {
    const dataset = {
      records: {
        participants: [{ id: 'speaker-one' }, { id: 'speaker-two' }],
        recordings: [
          { id: 'recording-one', participant_id: 'speaker-one' },
          { id: 'recording-two', participant_id: 'speaker-one' },
          { id: 'recording-three', participant_id: 'speaker-two' },
        ],
        transcriptions: [{ recording_id: 'recording-one', revision_number: 1, verbatim_text: 'Source transcript' }],
      },
    } as never;
    const drafts = [{ recordingId: 'recording-two', verbatimText: 'Local transcript' }] as never;
    expect(participantAnnotationProgress(dataset, drafts)).toEqual([
      { participantId: 'speaker-one', recordingCount: 2, transcribedCount: 2, complete: true },
      { participantId: 'speaker-two', recordingCount: 1, transcribedCount: 0, complete: false },
    ]);
    expect(firstIncompleteRecording(dataset, 'speaker-two', drafts)?.id).toBe('recording-three');
  });

  it('prefers an unfinished recording and lets a saved draft override source text', () => {
    const dataset = {
      records: {
        participants: [{ id: 'speaker-one' }],
        recordings: [{ id: 'one', participant_id: 'speaker-one' }, { id: 'two', participant_id: 'speaker-one' }],
        transcriptions: [{ recording_id: 'one', revision_number: 1, verbatim_text: 'Existing' }],
      },
    } as never;
    expect(firstIncompleteRecording(dataset, 'speaker-one', [])?.id).toBe('two');
    expect(participantAnnotationProgress(dataset, [{ recordingId: 'one', verbatimText: '' }] as never)[0].transcribedCount).toBe(0);
  });
});
