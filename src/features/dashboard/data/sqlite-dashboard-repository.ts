import type { SQLiteDatabase } from 'expo-sqlite';

import type { DashboardRepository, DashboardSummary } from './dashboard-repository';

type SummaryRow = {
  participant_count: number;
  session_count: number;
  recording_count: number;
  duration_ms: number;
  needs_review_count: number;
};

export function toDashboardSummary(row: SummaryRow | null): DashboardSummary {
  return {
    participantCount: row?.participant_count ?? 0,
    sessionCount: row?.session_count ?? 0,
    recordingCount: row?.recording_count ?? 0,
    durationMs: row?.duration_ms ?? 0,
    needsReviewCount: row?.needs_review_count ?? 0,
  };
}

export class SQLiteDashboardRepository implements DashboardRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getProjectSummary(projectId: string): Promise<DashboardSummary> {
    const row = await this.db.getFirstAsync<SummaryRow>(
      `SELECT
       (SELECT COUNT(*) FROM participants WHERE project_id = ? AND status != 'archived') AS participant_count,
       (SELECT COUNT(*) FROM sessions WHERE project_id = ? AND status != 'archived') AS session_count,
       (SELECT COUNT(*) FROM recordings WHERE project_id = ? AND archived_at IS NULL) AS recording_count,
       (SELECT COALESCE(SUM(duration_ms), 0) FROM recordings WHERE project_id = ? AND archived_at IS NULL) AS duration_ms,
       (SELECT COUNT(*) FROM recordings WHERE project_id = ? AND archived_at IS NULL AND annotation_status = 'needs_review') AS needs_review_count`,
      projectId, projectId, projectId, projectId, projectId,
    );
    return toDashboardSummary(row);
  }
}
