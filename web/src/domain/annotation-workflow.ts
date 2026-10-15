import { latestTranscription, type LoadedResearchDataset, type ResearchRecording } from './dataset';
import type { WebAnnotationDraft } from './draft';

export type ParticipantAnnotationProgress = {
  participantId: string;
  recordingCount: number;
  transcribedCount: number;
  complete: boolean;
};

export function effectiveAnnotationStatus(recording: ResearchRecording, draft?: WebAnnotationDraft): ResearchRecording['annotation_status'] {
  return draft?.annotationStatus ?? recording.annotation_status;
}

export function participantAnnotationProgress(dataset: LoadedResearchDataset, drafts: WebAnnotationDraft[]): ParticipantAnnotationProgress[] {
  const draftsByRecording = new Map(drafts.map((draft) => [draft.recordingId, draft]));
  return dataset.records.participants.map((participant) => {
    const recordings = dataset.records.recordings.filter((recording) => recording.participant_id === participant.id);
    const transcribedCount = recordings.filter((recording) => hasVerbatim(dataset, recording, draftsByRecording)).length;
    return {
      participantId: participant.id,
      recordingCount: recordings.length,
      transcribedCount,
      complete: recordings.length > 0 && transcribedCount === recordings.length,
    };
  });
}

export function firstIncompleteRecording(dataset: LoadedResearchDataset, participantId: string, drafts: WebAnnotationDraft[]): ResearchRecording | null {
  const draftsByRecording = new Map(drafts.map((draft) => [draft.recordingId, draft]));
  const recordings = dataset.records.recordings.filter((recording) => recording.participant_id === participantId);
  return recordings.find((recording) => !hasVerbatim(dataset, recording, draftsByRecording)) ?? recordings[0] ?? null;
}

export function recordingHasVerbatim(dataset: LoadedResearchDataset, recording: ResearchRecording, drafts: WebAnnotationDraft[]): boolean {
  return hasVerbatim(dataset, recording, new Map(drafts.map((draft) => [draft.recordingId, draft])));
}

function hasVerbatim(dataset: LoadedResearchDataset, recording: ResearchRecording, drafts: Map<string, WebAnnotationDraft>): boolean {
  const draft = drafts.get(recording.id);
  if (draft) return draft.verbatimText.trim().length > 0;
  return Boolean(latestTranscription(dataset, recording.id)?.verbatim_text?.trim());
}
