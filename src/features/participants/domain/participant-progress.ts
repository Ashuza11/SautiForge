export type ScenarioCollectionTarget = {
  scenarioId: string;
  requiredRecordingCount: number;
};

export type ParticipantRecordingProgress = {
  id: string;
  participantId: string;
  scenarioId: string;
  transcribed: boolean;
};

export type ParticipantProgress = {
  requiredRecordingCount: number;
  recordingCount: number;
  transcribedRecordingCount: number;
  collectionComplete: boolean;
  transcriptionComplete: boolean;
};

export function buildParticipantProgress(
  participantIds: string[],
  targets: ScenarioCollectionTarget[],
  recordings: ParticipantRecordingProgress[],
): Record<string, ParticipantProgress> {
  return Object.fromEntries(participantIds.map((participantId) => {
    const participantRecordings = recordings.filter((recording) => recording.participantId === participantId);
    const requiredRecordingCount = targets.reduce((total, target) => total + target.requiredRecordingCount, 0);
    const collectionComplete = targets.length > 0 && targets.every((target) => (
      participantRecordings.filter((recording) => recording.scenarioId === target.scenarioId).length >= target.requiredRecordingCount
    ));
    const transcribedRecordingCount = participantRecordings.filter((recording) => recording.transcribed).length;

    return [participantId, {
      requiredRecordingCount,
      recordingCount: participantRecordings.length,
      transcribedRecordingCount,
      collectionComplete,
      transcriptionComplete: collectionComplete
        && participantRecordings.length > 0
        && transcribedRecordingCount === participantRecordings.length,
    }];
  }));
}
