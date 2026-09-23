import type { SQLiteDatabase } from 'expo-sqlite';

import { newId, nowIso } from '@/domain/common';
import { projectDraftSchema, projectSchema, type Project, type ProjectDraft } from '../domain/project';
import type { ProjectRepository } from './project-repository';

type ProjectRow = {
  id: string;
  title: string;
  description: string;
  target_language: string;
  language_variety: string;
  research_domain: string;
  collection_location: string;
  protocol_version: string;
  status: Project['status'];
  created_at: string;
  updated_at: string;
};

const selectColumns = `id, title, description, target_language, language_variety,
  research_domain, collection_location, protocol_version, status, created_at, updated_at`;

function fromRow(row: ProjectRow): Project {
  return projectSchema.parse({
    id: row.id,
    title: row.title,
    description: row.description,
    targetLanguage: row.target_language,
    languageVariety: row.language_variety,
    researchDomain: row.research_domain,
    collectionLocation: row.collection_location,
    protocolVersion: row.protocol_version,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class SQLiteProjectRepository implements ProjectRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async list(includeArchived = false): Promise<Project[]> {
    const rows = await this.db.getAllAsync<ProjectRow>(
      `SELECT ${selectColumns} FROM projects ${includeArchived ? '' : "WHERE status = 'active'"} ORDER BY title COLLATE NOCASE`,
    );
    return rows.map(fromRow);
  }

  async get(id: string): Promise<Project | null> {
    const row = await this.db.getFirstAsync<ProjectRow>(
      `SELECT ${selectColumns} FROM projects WHERE id = ?`,
      id,
    );
    return row ? fromRow(row) : null;
  }

  async getActive(): Promise<Project | null> {
    const row = await this.db.getFirstAsync<ProjectRow>(
      `SELECT ${selectColumns} FROM projects
       WHERE id = (SELECT value FROM app_settings WHERE key = 'active_project_id')
         AND status = 'active'`,
    );
    return row ? fromRow(row) : null;
  }

  async create(input: ProjectDraft): Promise<Project> {
    const draft = projectDraftSchema.parse(input);
    const project: Project = projectSchema.parse({
      ...draft,
      id: newId(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    await this.db.runAsync(
      `INSERT INTO projects
        (id, title, description, target_language, language_variety, research_domain, collection_location, protocol_version, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      project.id,
      project.title,
      project.description,
      project.targetLanguage,
      project.languageVariety,
      project.researchDomain,
      project.collectionLocation,
      project.protocolVersion,
      project.status,
      project.createdAt,
      project.updatedAt,
    );
    return project;
  }

  async update(id: string, input: ProjectDraft): Promise<Project> {
    const draft = projectDraftSchema.parse(input);
    const updatedAt = nowIso();
    const result = await this.db.runAsync(
      `UPDATE projects SET title = ?, description = ?, target_language = ?, language_variety = ?,
       research_domain = ?, collection_location = ?, protocol_version = ?, status = ?, updated_at = ? WHERE id = ?`,
      draft.title,
      draft.description,
      draft.targetLanguage,
      draft.languageVariety,
      draft.researchDomain,
      draft.collectionLocation,
      draft.protocolVersion,
      draft.status,
      updatedAt,
      id,
    );
    if (result.changes !== 1) throw new Error('Project not found.');
    const project = await this.get(id);
    if (!project) throw new Error('Project was not readable after saving.');
    return project;
  }

  async setActive(id: string): Promise<void> {
    const project = await this.get(id);
    if (!project || project.status !== 'active') throw new Error('Only an active project can be selected.');
    await this.db.runAsync(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('active_project_id', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      id,
      nowIso(),
    );
  }

  async archive(id: string): Promise<void> {
    const result = await this.db.runAsync(
      `UPDATE projects SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'active'`,
      nowIso(),
      id,
    );
    if (result.changes !== 1) throw new Error('Active project not found.');
    await this.db.runAsync(
      `DELETE FROM app_settings WHERE key = 'active_project_id' AND value = ?`,
      id,
    );
  }
}
