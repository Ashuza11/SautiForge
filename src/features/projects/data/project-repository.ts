import type { Project, ProjectDraft } from '../domain/project';

export interface ProjectRepository {
  list(includeArchived?: boolean): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  getActive(): Promise<Project | null>;
  create(draft: ProjectDraft): Promise<Project>;
  update(id: string, draft: ProjectDraft): Promise<Project>;
  setActive(id: string): Promise<void>;
  archive(id: string): Promise<void>;
}
