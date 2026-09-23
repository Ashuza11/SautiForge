import type { SQLiteDatabase } from 'expo-sqlite';

import { newId, nowIso } from '@/domain/common';
import { scenarioDraftSchema, scenarioSchema, type Scenario, type ScenarioDraft } from '../domain/scenario';
import type { ScenarioRepository } from './scenario-repository';

type ScenarioRow = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  collection_instructions: string;
  expected_intent: string;
  collection_method: Scenario['collectionMethod'];
  version: string;
  reference_data_json: string | null;
  status: Scenario['status'];
  created_at: string;
  updated_at: string;
};

const selectColumns = `id, project_id, title, description, collection_instructions, expected_intent,
  collection_method, version, reference_data_json, status, created_at, updated_at`;

function fromRow(row: ScenarioRow): Scenario {
  return scenarioSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    collectionInstructions: row.collection_instructions,
    expectedIntent: row.expected_intent,
    collectionMethod: row.collection_method,
    version: row.version,
    referenceData: row.reference_data_json ? JSON.parse(row.reference_data_json) : null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class SQLiteScenarioRepository implements ScenarioRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async listByProject(projectId: string, includeArchived = false): Promise<Scenario[]> {
    const rows = await this.db.getAllAsync<ScenarioRow>(
      `SELECT ${selectColumns} FROM scenarios WHERE project_id = ? ${includeArchived ? '' : "AND status = 'active'"}
       ORDER BY title COLLATE NOCASE`,
      projectId,
    );
    return rows.map(fromRow);
  }

  async get(id: string): Promise<Scenario | null> {
    const row = await this.db.getFirstAsync<ScenarioRow>(
      `SELECT ${selectColumns} FROM scenarios WHERE id = ?`,
      id,
    );
    return row ? fromRow(row) : null;
  }

  async create(projectId: string, input: ScenarioDraft): Promise<Scenario> {
    const draft = scenarioDraftSchema.parse(input);
    const scenario = scenarioSchema.parse({
      ...draft,
      id: newId(),
      projectId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    await this.db.runAsync(
      `INSERT INTO scenarios
       (id, project_id, title, description, collection_instructions, expected_intent, collection_method,
        version, reference_data_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      scenario.id,
      scenario.projectId,
      scenario.title,
      scenario.description,
      scenario.collectionInstructions,
      scenario.expectedIntent,
      scenario.collectionMethod,
      scenario.version,
      scenario.referenceData ? JSON.stringify(scenario.referenceData) : null,
      scenario.status,
      scenario.createdAt,
      scenario.updatedAt,
    );
    return scenario;
  }

  async update(id: string, input: ScenarioDraft): Promise<Scenario> {
    const draft = scenarioDraftSchema.parse(input);
    const result = await this.db.runAsync(
      `UPDATE scenarios SET title = ?, description = ?, collection_instructions = ?, expected_intent = ?,
       collection_method = ?, version = ?, reference_data_json = ?, status = ?, updated_at = ? WHERE id = ?`,
      draft.title,
      draft.description,
      draft.collectionInstructions,
      draft.expectedIntent,
      draft.collectionMethod,
      draft.version,
      draft.referenceData ? JSON.stringify(draft.referenceData) : null,
      draft.status,
      nowIso(),
      id,
    );
    if (result.changes !== 1) throw new Error('Scenario not found.');
    const scenario = await this.get(id);
    if (!scenario) throw new Error('Scenario was not readable after saving.');
    return scenario;
  }

  async archive(id: string): Promise<void> {
    const result = await this.db.runAsync(
      `UPDATE scenarios SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'active'`,
      nowIso(),
      id,
    );
    if (result.changes !== 1) throw new Error('Active scenario not found.');
  }
}
