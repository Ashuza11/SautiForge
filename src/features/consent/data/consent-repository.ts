import type { ConsentDraft, ConsentRecord, SharingCategory } from '../domain/consent';

export interface ConsentRepository {
  listByParticipant(participantId: string): Promise<ConsentRecord[]>;
  getCurrent(participantId: string): Promise<ConsentRecord | null>;
  createRevision(participantId: string, draft: ConsentDraft): Promise<ConsentRecord>;
  participantCanRecord(participantId: string, at?: Date): Promise<boolean>;
  participantPermitsSharing(participantId: string, category: SharingCategory, at?: Date): Promise<boolean>;
}
