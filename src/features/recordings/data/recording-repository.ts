import type { AcceptedTake, Recording, RecordingMetadataDraft } from '../domain/recording';

export type RecordingSearch = {
  projectId?: string;
  query?: string;
  annotationStatus?: Recording['annotationStatus'];
  language?: string;
  qualityRating?: number;
};

export interface RecordingRepository {
  listBySession(sessionId: string): Promise<Recording[]>;
  search(filters: RecordingSearch): Promise<Recording[]>;
  get(id: string): Promise<Recording | null>;
  saveAcceptedTake(sessionId: string, scenarioId: string, take: AcceptedTake, metadata: RecordingMetadataDraft): Promise<Recording>;
  updateStatus(id: string, status: Recording['annotationStatus']): Promise<Recording>;
  archive(id: string): Promise<void>;
}
