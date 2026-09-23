import type { Participant, ParticipantDraft } from '../domain/participant';

export interface ParticipantRepository {
  listByProject(projectId: string, includeInactive?: boolean): Promise<Participant[]>;
  get(id: string): Promise<Participant | null>;
  create(projectId: string, draft: ParticipantDraft): Promise<Participant>;
  update(id: string, draft: ParticipantDraft): Promise<Participant>;
  archive(id: string): Promise<void>;
}
