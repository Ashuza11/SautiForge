import { describe, expect, it } from 'vitest';

import { buildRecordingSearchWhere } from './recording-search';

describe('recording library query', () => {
  it('builds all required filters with bound parameters', () => {
    const result = buildRecordingSearchWhere({
      projectId: 'project', participantId: 'participant', scenarioId: 'scenario', query: 'sale',
      annotationStatus: 'needs_review', language: ' Kingwana ', qualityRating: 4,
      recordedFrom: '2026-09-01', recordedTo: '2026-09-23',
    });
    expect(result.clause).toContain('r.project_id = ?');
    expect(result.clause).toContain('r.participant_id = ?');
    expect(result.clause).toContain('r.scenario_id = ?');
    expect(result.clause).toContain('r.recorded_at >= ?');
    expect(result.clause).toContain('r.recorded_at <= ?');
    expect(result.parameters).toEqual([
      'project', 'participant', 'scenario', 'needs_review', '%Kingwana%', 4,
      '2026-09-01T00:00:00.000Z', '2026-09-23T23:59:59.999Z', '%sale%', '%sale%', '%sale%', '%sale%',
    ]);
  });

  it('always excludes soft-archived recordings', () => {
    expect(buildRecordingSearchWhere({}).clause).toBe('r.archived_at IS NULL');
  });
});
