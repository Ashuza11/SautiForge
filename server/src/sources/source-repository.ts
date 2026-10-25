import type {
  Source,
  SourceRightsDraft,
  SourceRightsRevision,
  SourceStatus,
} from './source';

export interface SourceRepository {
  list(projectId: string, includeInactive: boolean): Promise<Source[]>;
  getById(id: string): Promise<Source | null>;
  getLatestRights(sourceId: string): Promise<SourceRightsRevision | null>;
  listRightsHistory(sourceId: string): Promise<SourceRightsRevision[]>;
  create(source: Source): Promise<Source>;
  updateMetadata(source: Source): Promise<Source | null>;
  addRightsRevision(input: {
    id: string;
    sourceId: string;
    status: SourceStatus;
    draft: SourceRightsDraft;
    createdAt: string;
  }): Promise<{ source: Source; revision: SourceRightsRevision } | null>;
}
