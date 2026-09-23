import type { Transcription, TranscriptionDraft } from '../domain/transcription';

export interface TranscriptionRepository {
  listRevisions(recordingId: string): Promise<Transcription[]>;
  getCurrent(recordingId: string): Promise<Transcription | null>;
  createRevision(recordingId: string, draft: TranscriptionDraft): Promise<Transcription>;
}
