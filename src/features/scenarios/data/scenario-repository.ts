import type { Scenario, ScenarioDraft } from '../domain/scenario';

export interface ScenarioRepository {
  listByProject(projectId: string, includeArchived?: boolean): Promise<Scenario[]>;
  get(id: string): Promise<Scenario | null>;
  create(projectId: string, draft: ScenarioDraft): Promise<Scenario>;
  update(id: string, draft: ScenarioDraft): Promise<Scenario>;
  archive(id: string): Promise<void>;
}
