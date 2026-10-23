import type { Project } from '../../../src/features/projects/domain/project';

export interface ProjectRepository {
  list(includeArchived: boolean): Promise<Project[]>;
  getById(id: string): Promise<Project | null>;
  create(project: Project): Promise<Project>;
  update(project: Project): Promise<Project | null>;
  archive(id: string, updatedAt: string): Promise<Project | null>;
  ping(): Promise<void>;
}
