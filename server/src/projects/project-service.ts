import { randomUUID } from 'node:crypto';

import {
  projectDraftSchema,
  projectSchema,
  type Project,
  type ProjectDraft,
} from '../../../src/features/projects/domain/project';
import type { ProjectRepository } from './project-repository';

export type ProjectServiceOptions = {
  idFactory?: () => string;
  now?: () => Date;
};

export class ProjectService {
  private readonly idFactory: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly repository: ProjectRepository,
    options: ProjectServiceOptions = {},
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  list(includeArchived = false): Promise<Project[]> {
    return this.repository.list(includeArchived);
  }

  create(input: ProjectDraft): Promise<Project> {
    const draft = projectDraftSchema.parse(input);
    const timestamp = this.now().toISOString();
    return this.repository.create(projectSchema.parse({
      ...draft,
      id: this.idFactory(),
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
  }

  async update(id: string, input: ProjectDraft): Promise<Project | null> {
    const current = await this.repository.getById(id);
    if (!current) return null;
    const draft = projectDraftSchema.parse(input);
    return this.repository.update(projectSchema.parse({
      ...current,
      ...draft,
      id,
      updatedAt: this.now().toISOString(),
    }));
  }

  archive(id: string): Promise<Project | null> {
    return this.repository.archive(id, this.now().toISOString());
  }
}
