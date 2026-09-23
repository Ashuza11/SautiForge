import type { CollectionSession, SessionDraft } from '../domain/session';

export interface SessionRepository {
  listByParticipant(participantId: string): Promise<CollectionSession[]>;
  get(id: string): Promise<CollectionSession | null>;
  create(projectId: string, participantId: string, draft: SessionDraft): Promise<CollectionSession>;
  resume(id: string): Promise<CollectionSession>;
  pause(id: string): Promise<CollectionSession>;
  complete(id: string): Promise<CollectionSession>;
}
