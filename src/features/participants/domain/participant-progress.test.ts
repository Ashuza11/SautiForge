import { describe, expect, it } from 'vitest';

import { buildParticipantProgress } from './participant-progress';

const targets = [
  { scenarioId: 'sale', requiredRecordingCount: 2 },
  { scenarioId: 'debt', requiredRecordingCount: 1 },
];

describe('participant collection progress', () => {
  it('requires the configured number of recordings for every active scenario', () => {
    const progress = buildParticipantProgress(['speaker'], targets, [
      { id: 'one', participantId: 'speaker', scenarioId: 'sale', transcribed: true },
      { id: 'two', participantId: 'speaker', scenarioId: 'sale', transcribed: true },
      { id: 'three', participantId: 'speaker', scenarioId: 'debt', transcribed: false },
    ]).speaker;

    expect(progress).toEqual({
      requiredRecordingCount: 3,
      recordingCount: 3,
      transcribedRecordingCount: 2,
      collectionComplete: true,
      transcriptionComplete: false,
    });
  });

  it('marks transcription complete only when every retained take has verbatim text', () => {
    const progress = buildParticipantProgress(['speaker'], targets, [
      { id: 'one', participantId: 'speaker', scenarioId: 'sale', transcribed: true },
      { id: 'two', participantId: 'speaker', scenarioId: 'sale', transcribed: true },
      { id: 'three', participantId: 'speaker', scenarioId: 'debt', transcribed: true },
    ]).speaker;

    expect(progress.collectionComplete).toBe(true);
    expect(progress.transcriptionComplete).toBe(true);
  });

  it('does not report completion when a project has no active scenarios', () => {
    expect(buildParticipantProgress(['speaker'], [], []).speaker).toMatchObject({
      collectionComplete: false,
      transcriptionComplete: false,
    });
  });
});
