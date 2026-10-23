import { z } from 'zod';

import { projectDraftSchema, projectSchema, type Project, type ProjectDraft } from '../../../src/features/projects/domain/project';

const storedProjectsSchema = z.object({
  schemaVersion: z.literal(1),
  projects: z.array(projectSchema),
}).strict();

export const projectTemplateSchema = z.object({
  kind: z.literal('sautiforge.project-template'),
  schemaVersion: z.literal(1),
  project: projectSchema,
}).strict();

export type ProjectStorage = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_KEY = 'sautiforge.web.projects.v1';

export class LocalProjectWorkspaceRepository {
  constructor(
    private readonly storage: ProjectStorage,
    private readonly idFactory: () => string = () => crypto.randomUUID(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(includeArchived = false): Project[] {
    const projects = this.readAll();
    return projects
      .filter((project) => includeArchived || project.status === 'active')
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  create(input: ProjectDraft): Project {
    const draft = projectDraftSchema.parse(input);
    const timestamp = this.now().toISOString();
    const project = projectSchema.parse({
      ...draft,
      id: this.idFactory(),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const projects = this.readAll();
    if (projects.some((item) => item.id === project.id)) throw new Error('A project with this identifier already exists.');
    return this.writeAndVerify([...projects, project], project.id);
  }

  update(id: string, input: ProjectDraft): Project {
    const draft = projectDraftSchema.parse(input);
    const projects = this.readAll();
    const existing = projects.find((project) => project.id === id);
    if (!existing) throw new Error('Project not found.');
    const updated = projectSchema.parse({ ...existing, ...draft, id, updatedAt: this.now().toISOString() });
    return this.writeAndVerify(projects.map((project) => project.id === id ? updated : project), id);
  }

  archive(id: string): Project {
    const projects = this.readAll();
    const existing = projects.find((project) => project.id === id);
    if (!existing) throw new Error('Project not found.');
    const archived = projectSchema.parse({ ...existing, status: 'archived', updatedAt: this.now().toISOString() });
    return this.writeAndVerify(projects.map((project) => project.id === id ? archived : project), id);
  }

  private readAll(): Project[] {
    let value: string | null;
    try { value = this.storage.getItem(STORAGE_KEY); }
    catch { throw new Error('Project storage is unavailable in this browser.'); }
    if (!value) return [];
    try { return storedProjectsSchema.parse(JSON.parse(value)).projects; }
    catch { throw new Error('The saved web project configurations are invalid and cannot be opened safely.'); }
  }

  private writeAndVerify(projects: Project[], expectedId: string): Project {
    const envelope = storedProjectsSchema.parse({ schemaVersion: 1, projects });
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify(envelope)); }
    catch { throw new Error('The project configuration could not be written to browser storage.'); }
    const verified = this.readAll().find((project) => project.id === expectedId);
    if (!verified) throw new Error('The project configuration was not readable after saving and has not been confirmed as saved.');
    return verified;
  }
}

export function serializeProjectTemplate(project: Project): string {
  return `${JSON.stringify(projectTemplateSchema.parse({
    kind: 'sautiforge.project-template',
    schemaVersion: 1,
    project,
  }), null, 2)}\n`;
}
