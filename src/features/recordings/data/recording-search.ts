import type { RecordingSearch } from './recording-repository';

export function buildRecordingSearchWhere(filters: RecordingSearch): { clause: string; parameters: Array<string | number> } {
  const conditions = ['r.archived_at IS NULL'];
  const parameters: Array<string | number> = [];
  if (filters.projectId) { conditions.push('r.project_id = ?'); parameters.push(filters.projectId); }
  if (filters.participantId) { conditions.push('r.participant_id = ?'); parameters.push(filters.participantId); }
  if (filters.scenarioId) { conditions.push('r.scenario_id = ?'); parameters.push(filters.scenarioId); }
  if (filters.annotationStatus) { conditions.push('r.annotation_status = ?'); parameters.push(filters.annotationStatus); }
  if (filters.language?.trim()) { conditions.push('r.spoken_languages_json LIKE ?'); parameters.push(`%${filters.language.trim()}%`); }
  if (filters.qualityRating) { conditions.push('r.quality_rating = ?'); parameters.push(filters.qualityRating); }
  if (filters.recordedFrom) { conditions.push('r.recorded_at >= ?'); parameters.push(`${filters.recordedFrom}T00:00:00.000Z`); }
  if (filters.recordedTo) { conditions.push('r.recorded_at <= ?'); parameters.push(`${filters.recordedTo}T23:59:59.999Z`); }
  if (filters.query?.trim()) {
    conditions.push('(r.display_id LIKE ? OR p.speaker_code LIKE ? OR sc.title LIKE ? OR r.notes LIKE ?)');
    const query = `%${filters.query.trim()}%`;
    parameters.push(query, query, query, query);
  }
  return { clause: conditions.join(' AND '), parameters };
}
