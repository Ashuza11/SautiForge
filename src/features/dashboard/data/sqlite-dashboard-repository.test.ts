import { describe, expect, it } from 'vitest';

import { toDashboardSummary } from './sqlite-dashboard-repository';

describe('dashboard summary', () => {
  it('maps aggregate counts and duration', () => {
    expect(toDashboardSummary({ participant_count: 2, session_count: 3, recording_count: 5, duration_ms: 91_000, needs_review_count: 1 })).toEqual({
      participantCount: 2, sessionCount: 3, recordingCount: 5, durationMs: 91_000, needsReviewCount: 1,
    });
  });

  it('uses zeroes for an empty project', () => {
    expect(toDashboardSummary(null)).toEqual({ participantCount: 0, sessionCount: 0, recordingCount: 0, durationMs: 0, needsReviewCount: 0 });
  });
});
