import { describe, expect, it } from 'vitest';

import type { Project, ProjectDraft } from '../../../src/features/projects/domain/project';
import type { ProjectRepository } from './project-repository';
import { ProjectService } from './project-service';

const projectId = '00000000-0000-4000-8000-000000000001';
const draft: ProjectDraft = {
  title: 'Community speech pilot',
  description: 'Permission-cleared community transcription.',
  targetLanguage: 'Shi',
  languageCode: 'shr',
  languageVariety: 'Mashi',
  researchDomain: 'General speech',
  collectionLocation: 'South Kivu, DRC',
  protocolVersion: '2.0',
  annotationProfile: 'verbatim_transcription',
  status: 'active',
};

class MemoryProjectRepository implements ProjectRepository {
  projects = new Map<string, Project>();
  async list(includeArchived: boolean) {
    return [...this.projects.values()].filter((project) => includeArchived || project.status === 'active');
  }
  async getById(id: string) { return this.projects.get(id) ?? null; }
  async create(project: Project) { this.projects.set(project.id, project); return project; }
  async update(project: Project) { this.projects.set(project.id, project); return project; }
  async archive(id: string, updatedAt: string) {
    const project = this.projects.get(id);
    if (!project) return null;
    const archived: Project = { ...project, status: 'archived', updatedAt };
    this.projects.set(id, archived);
    return archived;
  }
  async ping() {}
}

describe('ProjectService', () => {
  it('creates stable server-owned IDs and timestamps', async () => {
    const repository = new MemoryProjectRepository();
    const service = new ProjectService(repository, {
      idFactory: () => projectId,
      now: () => new Date('2026-10-24T08:00:00.000Z'),
    });

    await expect(service.create(draft)).resolves.toMatchObject({
      ...draft,
      id: projectId,
      createdAt: '2026-10-24T08:00:00.000Z',
      updatedAt: '2026-10-24T08:00:00.000Z',
    });
  });

  it('updates and archives without changing project identity or creation time', async () => {
    const repository = new MemoryProjectRepository();
    const dates = [new Date('2026-10-24T08:00:00.000Z'), new Date('2026-10-24T09:00:00.000Z'), new Date('2026-10-24T10:00:00.000Z')];
    const service = new ProjectService(repository, { idFactory: () => projectId, now: () => dates.shift()! });
    const created = await service.create(draft);
    const updated = await service.update(projectId, { ...draft, title: 'Updated pilot' });
    const archived = await service.archive(projectId);

    expect(updated).toMatchObject({ id: projectId, title: 'Updated pilot', createdAt: created.createdAt });
    expect(archived).toMatchObject({ id: projectId, status: 'archived', createdAt: created.createdAt });
    await expect(service.list()).resolves.toEqual([]);
    await expect(service.list(true)).resolves.toHaveLength(1);
  });

  it('returns null when updating or archiving an unknown project', async () => {
    const service = new ProjectService(new MemoryProjectRepository(), { now: () => new Date() });
    await expect(service.update(projectId, draft)).resolves.toBeNull();
    await expect(service.archive(projectId)).resolves.toBeNull();
  });
});
