import type { Participant, ParticipantDraft } from '../domain/participant';
import type { ParticipantProgress } from '../domain/participant-progress';

export interface ParticipantRepository {
  listByProject(projectId: string, includeInactive?: boolean): Promise<Participant[]>;
  getProgressByProject(projectId: string): Promise<Record<string, ParticipantProgress>>;
  get(id: string): Promise<Participant | null>;
  create(projectId: string, draft: ParticipantDraft): Promise<Participant>;
  update(id: string, draft: ParticipantDraft): Promise<Participant>;
  archive(id: string): Promise<void>;
}
