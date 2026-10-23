import { projectSchema, type Project } from '../../../src/features/projects/domain/project';
import type { SqlExecutor } from '../database/neon';
import type { ProjectRepository } from './project-repository';

type ProjectRow = {
  id: string;
  title: string;
  description: string;
  target_language: string;
  language_code: string;
  language_variety: string;
  research_domain: string;
  collection_location: string;
  protocol_version: string;
  annotation_profile: string;
  status: string;
  created_at: string | Date;
  updated_at: string | Date;
};

const PROJECT_COLUMNS = `
  id, title, description, target_language, language_code, language_variety,
  research_domain, collection_location, protocol_version, annotation_profile,
  status, created_at, updated_at
`;

function timestamp(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapProject(row: ProjectRow): Project {
  return projectSchema.parse({
    id: row.id,
    title: row.title,
    description: row.description,
    targetLanguage: row.target_language,
    languageCode: row.language_code,
    languageVariety: row.language_variety,
    researchDomain: row.research_domain,
    collectionLocation: row.collection_location,
    protocolVersion: row.protocol_version,
    annotationProfile: row.annotation_profile,
    status: row.status,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  });
}

export class NeonProjectRepository implements ProjectRepository {
  constructor(private readonly database: SqlExecutor) {}

  async list(includeArchived: boolean): Promise<Project[]> {
    const rows = await this.database.query<ProjectRow>(`
      SELECT ${PROJECT_COLUMNS}
      FROM projects
      WHERE $1::boolean OR status = 'active'
      ORDER BY title ASC, id ASC
    `, [includeArchived]);
    return rows.map(mapProject);
  }

  async create(project: Project): Promise<Project> {
    const rows = await this.database.query<ProjectRow>(`
      INSERT INTO projects (
        id, title, description, target_language, language_code, language_variety,
        research_domain, collection_location, protocol_version, annotation_profile,
        status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13
      )
      RETURNING ${PROJECT_COLUMNS}
    `, projectValues(project));
    return mapProject(requireRow(rows));
  }

  async getById(id: string): Promise<Project | null> {
    const rows = await this.database.query<ProjectRow>(`
      SELECT ${PROJECT_COLUMNS}
      FROM projects
      WHERE id = $1
    `, [id]);
    return rows[0] ? mapProject(rows[0]) : null;
  }

  async update(project: Project): Promise<Project | null> {
    const rows = await this.database.query<ProjectRow>(`
      UPDATE projects
      SET title = $2,
          description = $3,
          target_language = $4,
          language_code = $5,
          language_variety = $6,
          research_domain = $7,
          collection_location = $8,
          protocol_version = $9,
          annotation_profile = $10,
          status = $11,
          updated_at = $13
      WHERE id = $1
      RETURNING ${PROJECT_COLUMNS}
    `, projectValues(project));
    return rows[0] ? mapProject(rows[0]) : null;
  }

  async archive(id: string, updatedAt: string): Promise<Project | null> {
    const rows = await this.database.query<ProjectRow>(`
      UPDATE projects
      SET status = 'archived', updated_at = $2
      WHERE id = $1
      RETURNING ${PROJECT_COLUMNS}
    `, [id, updatedAt]);
    return rows[0] ? mapProject(rows[0]) : null;
  }

  async ping(): Promise<void> {
    await this.database.query('SELECT 1 AS available');
  }
}

function projectValues(project: Project): readonly unknown[] {
  return [
    project.id,
    project.title,
    project.description,
    project.targetLanguage,
    project.languageCode,
    project.languageVariety,
    project.researchDomain,
    project.collectionLocation,
    project.protocolVersion,
    project.annotationProfile,
    project.status,
    project.createdAt,
    project.updatedAt,
  ];
}

function requireRow(rows: ProjectRow[]): ProjectRow {
  const row = rows[0];
  if (!row) throw new Error('The database did not return the saved project.');
  return row;
}
