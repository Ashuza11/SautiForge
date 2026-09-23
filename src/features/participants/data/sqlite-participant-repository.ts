import type { SQLiteDatabase } from 'expo-sqlite';

import { newId, nowIso } from '@/domain/common';
import { participantDraftSchema, participantSchema, type Participant, type ParticipantDraft } from '../domain/participant';
import type { ParticipantRepository } from './participant-repository';

type ParticipantRow = {
  id: string;
  project_id: string;
  speaker_code: string;
  primary_language: string;
  language_variety: string | null;
  other_languages_json: string;
  age_bracket: string | null;
  gender_self_described: string | null;
  business_category: string | null;
  years_business_experience: number | null;
  research_notes: string | null;
  status: Participant['status'];
  created_at: string;
  updated_at: string;
};

const columns = `id, project_id, speaker_code, primary_language, language_variety, other_languages_json,
  age_bracket, gender_self_described, business_category, years_business_experience, research_notes,
  status, created_at, updated_at`;

function fromRow(row: ParticipantRow): Participant {
  return participantSchema.parse({
    id: row.id,
    projectId: row.project_id,
    speakerCode: row.speaker_code,
    primaryLanguage: row.primary_language,
    languageVariety: row.language_variety,
    otherLanguages: JSON.parse(row.other_languages_json),
    ageBracket: row.age_bracket,
    genderSelfDescribed: row.gender_self_described,
    businessCategory: row.business_category,
    yearsBusinessExperience: row.years_business_experience,
    researchNotes: row.research_notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class SQLiteParticipantRepository implements ParticipantRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async listByProject(projectId: string, includeInactive = false): Promise<Participant[]> {
    const rows = await this.db.getAllAsync<ParticipantRow>(
      `SELECT ${columns} FROM participants WHERE project_id = ? ${includeInactive ? '' : "AND status = 'active'"}
       ORDER BY speaker_code COLLATE NOCASE`,
      projectId,
    );
    return rows.map(fromRow);
  }

  async get(id: string): Promise<Participant | null> {
    const row = await this.db.getFirstAsync<ParticipantRow>(`SELECT ${columns} FROM participants WHERE id = ?`, id);
    return row ? fromRow(row) : null;
  }

  async create(projectId: string, input: ParticipantDraft): Promise<Participant> {
    const draft = participantDraftSchema.parse(input);
    const timestamp = nowIso();
    const participant = participantSchema.parse({ ...draft, id: newId(), projectId, createdAt: timestamp, updatedAt: timestamp });
    await this.db.runAsync(
      `INSERT INTO participants
       (id, project_id, speaker_code, primary_language, language_variety, other_languages_json, age_bracket,
        gender_self_described, business_category, years_business_experience, research_notes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      participant.id,
      participant.projectId,
      participant.speakerCode,
      participant.primaryLanguage,
      participant.languageVariety,
      JSON.stringify(participant.otherLanguages),
      participant.ageBracket,
      participant.genderSelfDescribed,
      participant.businessCategory,
      participant.yearsBusinessExperience,
      participant.researchNotes,
      participant.status,
      participant.createdAt,
      participant.updatedAt,
    );
    return participant;
  }

  async update(id: string, input: ParticipantDraft): Promise<Participant> {
    const draft = participantDraftSchema.parse(input);
    const result = await this.db.runAsync(
      `UPDATE participants SET speaker_code = ?, primary_language = ?, language_variety = ?, other_languages_json = ?,
       age_bracket = ?, gender_self_described = ?, business_category = ?, years_business_experience = ?,
       research_notes = ?, status = ?, updated_at = ? WHERE id = ?`,
      draft.speakerCode,
      draft.primaryLanguage,
      draft.languageVariety,
      JSON.stringify(draft.otherLanguages),
      draft.ageBracket,
      draft.genderSelfDescribed,
      draft.businessCategory,
      draft.yearsBusinessExperience,
      draft.researchNotes,
      draft.status,
      nowIso(),
      id,
    );
    if (result.changes !== 1) throw new Error('Participant not found.');
    const participant = await this.get(id);
    if (!participant) throw new Error('Participant was not readable after saving.');
    return participant;
  }

  async archive(id: string): Promise<void> {
    const result = await this.db.runAsync(
      `UPDATE participants SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'active'`,
      nowIso(),
      id,
    );
    if (result.changes !== 1) throw new Error('Active participant not found.');
  }
}
