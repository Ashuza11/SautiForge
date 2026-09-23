import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'sautiforge.db';
export const DATABASE_VERSION = 3;
export const DATABASE_OPEN_PRAGMAS = 'PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;';
export const DATABASE_CREATE_PRAGMAS = 'PRAGMA journal_mode = WAL;';

export const MIGRATION_1_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target_language TEXT NOT NULL,
  language_variety TEXT NOT NULL,
  research_domain TEXT NOT NULL,
  collection_location TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  collection_instructions TEXT NOT NULL,
  expected_intent TEXT NOT NULL,
  collection_method TEXT NOT NULL,
  version TEXT NOT NULL,
  reference_data_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  speaker_code TEXT NOT NULL,
  primary_language TEXT NOT NULL,
  language_variety TEXT,
  other_languages_json TEXT NOT NULL DEFAULT '[]',
  age_bracket TEXT,
  gender_self_described TEXT,
  business_category TEXT,
  years_business_experience REAL,
  research_notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'withdrawn', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, speaker_code)
);

CREATE TABLE IF NOT EXISTS consent_records (
  id TEXT PRIMARY KEY NOT NULL,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('granted', 'declined', 'withdrawn', 'expired')),
  internal_research INTEGER NOT NULL CHECK (internal_research IN (0, 1)),
  restricted_annotation INTEGER NOT NULL CHECK (restricted_annotation IN (0, 1)),
  public_release INTEGER NOT NULL CHECK (public_release IN (0, 1)),
  recorded_by TEXT,
  consented_at TEXT NOT NULL,
  valid_until TEXT,
  supersedes_id TEXT REFERENCES consent_records(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  device_metadata_json TEXT NOT NULL,
  collection_environment TEXT NOT NULL,
  city TEXT,
  researcher_notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'paused', 'completed', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY NOT NULL,
  display_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  scenario_version TEXT NOT NULL,
  scenario_prompt_snapshot_json TEXT NOT NULL,
  relative_audio_path TEXT NOT NULL UNIQUE,
  collection_method TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes >= 0),
  container TEXT NOT NULL,
  codec TEXT,
  sample_rate_hz INTEGER,
  channel_count INTEGER,
  spoken_languages_json TEXT NOT NULL,
  language_variety TEXT,
  code_switching_status TEXT,
  recording_environment TEXT,
  noise_level TEXT,
  quality_rating INTEGER CHECK (quality_rating IS NULL OR quality_rating BETWEEN 1 AND 5),
  notes TEXT,
  annotation_status TEXT NOT NULL CHECK (annotation_status IN ('recorded', 'needs_transcription', 'transcribed', 'needs_review', 'validated', 'rejected')),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcriptions (
  id TEXT PRIMARY KEY NOT NULL,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  verbatim_text TEXT,
  normalized_text TEXT,
  language_tags_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  source TEXT NOT NULL CHECK (source IN ('human', 'automatic')),
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  supersedes_id TEXT REFERENCES transcriptions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE(recording_id, revision_number)
);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY NOT NULL,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  annotation_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('human', 'automatic')),
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  supersedes_id TEXT REFERENCES annotations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE(recording_id, annotation_type, revision_number)
);

CREATE TABLE IF NOT EXISTS export_history (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT REFERENCES projects(id) ON UPDATE CASCADE ON DELETE SET NULL,
  export_type TEXT NOT NULL CHECK (export_type IN ('research_dataset', 'administrative_backup')),
  sharing_category TEXT,
  schema_version TEXT NOT NULL,
  destination_uri TEXT,
  archive_file_name TEXT NOT NULL,
  archive_size_bytes INTEGER,
  manifest_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scenarios_project ON scenarios(project_id, status);
CREATE INDEX IF NOT EXISTS idx_participants_project ON participants(project_id, status);
CREATE INDEX IF NOT EXISTS idx_consents_participant ON consent_records(participant_id, consented_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project_participant ON sessions(project_id, participant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_library ON recordings(project_id, annotation_status, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_session ON recordings(session_id);
CREATE INDEX IF NOT EXISTS idx_transcriptions_recording ON transcriptions(recording_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_annotations_recording ON annotations(recording_id, annotation_type, revision_number DESC);
`;

export const MIGRATION_2_SQL = `
ALTER TABLE consent_records ADD COLUMN consent_protocol_version TEXT NOT NULL DEFAULT 'unspecified';
`;

export const MIGRATION_3_SQL = `
ALTER TABLE sessions ADD COLUMN consent_record_id TEXT REFERENCES consent_records(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE recordings ADD COLUMN consent_record_id TEXT REFERENCES consent_records(id) ON UPDATE CASCADE ON DELETE RESTRICT;
`;

const KINGWANA_PROJECT_ID = '6a7d8df7-d495-4f69-9934-dc48ce5ee8d1';
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

const seedScenarios = [
  ['17f523b2-2db8-4f59-82e9-e70b182656f1', 'Recording a sale', 'Elicit a fictional or sanitized sale transaction.', 'Ask the participant to describe a routine sale without naming a real customer.', 'record_sale'],
  ['ae1f2d98-3cab-4751-8a47-50ca3ec31e38', 'Recording customer debt', 'Elicit a fictional sale where part of the amount remains unpaid.', 'Use a fictional customer and do not collect account or mobile-money credentials.', 'record_customer_debt'],
  ['7c29d7a0-edc4-4d77-83b5-021c799046f5', 'Updating inventory', 'Elicit a stock quantity update.', 'Ask the participant to describe adding or correcting stock for a common product.', 'update_inventory'],
  ['7fb0b424-0a02-48b7-9013-34b5f3f940e4', 'Recording debt repayment', 'Elicit a fictional debt repayment.', 'Use a sanitized example and never record a PIN or private customer conversation.', 'record_debt_repayment'],
  ['8601ca4f-bca9-4e2d-a938-4bf20e30edc3', 'Querying business information', 'Elicit a natural-language question about business records.', 'Ask for a question about fictional sales, debts, or inventory.', 'query_business_information'],
] as const;

async function seedFirstRun(db: SQLiteDatabase): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO projects
      (id, title, description, target_language, language_variety, research_domain, collection_location, protocol_version, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    KINGWANA_PROJECT_ID,
    'Kingwana Speech-to-Structured Data Pilot',
    'Editable pilot project for collecting pseudonymous, consented speech samples from telecom vendors.',
    'Swahili',
    'Kingwana',
    'Spoken business record keeping',
    'Bukavu, Democratic Republic of Congo',
    '0.1',
    SEEDED_AT,
    SEEDED_AT,
  );

  for (const [id, title, description, instructions, intent] of seedScenarios) {
    await db.runAsync(
      `INSERT OR IGNORE INTO scenarios
        (id, project_id, title, description, collection_instructions, expected_intent, collection_method, version, reference_data_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'elicited_prompt', '1.0', NULL, 'active', ?, ?)`,
      id,
      KINGWANA_PROJECT_ID,
      title,
      description,
      instructions,
      intent,
      SEEDED_AT,
      SEEDED_AT,
    );
  }

  await db.runAsync(
    `INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES ('active_project_id', ?, ?)`,
    KINGWANA_PROJECT_ID,
    SEEDED_AT,
  );
}

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(DATABASE_OPEN_PRAGMAS);
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentVersion = row?.user_version ?? 0;

  if (currentVersion > DATABASE_VERSION) {
    throw new Error(`Database version ${currentVersion} is newer than this app supports (${DATABASE_VERSION}).`);
  }

  if (currentVersion === 0) {
    // journal_mode cannot be changed from inside a transaction.
    await db.execAsync(DATABASE_CREATE_PRAGMAS);
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(MIGRATION_1_SQL);
      await seedFirstRun(transaction);
      await transaction.execAsync('PRAGMA user_version = 1');
    });
    currentVersion = 1;
  }

  if (currentVersion === 1) {
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(MIGRATION_2_SQL);
      await transaction.execAsync('PRAGMA user_version = 2');
    });
    currentVersion = 2;
  }

  if (currentVersion === 2) {
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(MIGRATION_3_SQL);
      await transaction.execAsync('PRAGMA user_version = 3');
    });
    currentVersion = 3;
  }

  await db.execAsync(DATABASE_OPEN_PRAGMAS);
}
