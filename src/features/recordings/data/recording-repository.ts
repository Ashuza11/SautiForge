import type { AcceptedTake, Recording, RecordingMetadataDraft, RecordingPromptCorrection, RecordingPromptCorrectionDraft } from '../domain/recording';

export type RecordingSearch = {
  projectId?: string;
  participantId?: string;
  scenarioId?: string;
  query?: string;
  annotationStatus?: Recording['annotationStatus'];
  language?: string;
  qualityRating?: number;
  recordedFrom?: string;
  recordedTo?: string;
};

export interface RecordingRepository {
  listBySession(sessionId: string): Promise<Recording[]>;
  search(filters: RecordingSearch): Promise<Recording[]>;
  get(id: string): Promise<Recording | null>;
  saveAcceptedTake(sessionId: string, scenarioId: string, take: AcceptedTake, metadata: RecordingMetadataDraft): Promise<Recording>;
  updateStatus(id: string, status: Recording['annotationStatus']): Promise<Recording>;
  listPromptCorrections(id: string): Promise<RecordingPromptCorrection[]>;
  correctElicitationPrompt(id: string, correction: RecordingPromptCorrectionDraft): Promise<Recording>;
  archive(id: string): Promise<void>;
}
