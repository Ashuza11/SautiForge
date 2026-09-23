export type DashboardSummary = {
  participantCount: number;
  sessionCount: number;
  recordingCount: number;
  durationMs: number;
  needsReviewCount: number;
};

export interface DashboardRepository {
  getProjectSummary(projectId: string): Promise<DashboardSummary>;
}
