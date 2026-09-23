import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

import { DATABASE_CREATE_PRAGMAS, DATABASE_OPEN_PRAGMAS, DATABASE_VERSION, MIGRATION_1_SQL, MIGRATION_2_SQL, MIGRATION_3_SQL } from './migrations';

const requiredTables = [
  'projects',
  'scenarios',
  'participants',
  'consent_records',
  'sessions',
  'recordings',
  'transcriptions',
  'annotations',
  'export_history',
];

describe('database migration 1', () => {
  it('has an explicit schema version', () => {
    expect(DATABASE_VERSION).toBe(3);
  });

  it.each(requiredTables)('creates the %s table', (table) => {
    expect(MIGRATION_1_SQL).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
  });

  it('enables foreign keys and WAL journaling', () => {
    expect(DATABASE_OPEN_PRAGMAS).toContain('PRAGMA foreign_keys = ON');
    expect(DATABASE_CREATE_PRAGMAS).toContain('PRAGMA journal_mode = WAL');
  });

  it('adds an explicit consent protocol version in migration 2', () => {
    expect(MIGRATION_2_SQL).toContain('consent_protocol_version');
  });

  it('links sessions and recordings to the authorizing consent revision in migration 3', () => {
    expect(MIGRATION_3_SQL).toContain('ALTER TABLE sessions ADD COLUMN consent_record_id');
    expect(MIGRATION_3_SQL).toContain('ALTER TABLE recordings ADD COLUMN consent_record_id');
  });

  it('executes the complete migration chain in SQLite', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(DATABASE_OPEN_PRAGMAS);
      db.exec(MIGRATION_1_SQL);
      db.exec(MIGRATION_2_SQL);
      db.exec(MIGRATION_3_SQL);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name));
      expect(tables).toEqual(expect.arrayContaining(requiredTables));
      expect(db.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 });
    } finally { db.close(); }
  });

  it('enforces project relationships and unique pseudonymous speaker IDs', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(DATABASE_OPEN_PRAGMAS);
      db.exec(MIGRATION_1_SQL);
      db.exec(MIGRATION_2_SQL);
      db.exec(MIGRATION_3_SQL);
      const timestamp = '2026-09-23T08:00:00.000Z';
      db.prepare(`INSERT INTO projects (id, title, description, target_language, language_variety, research_domain,
        collection_location, protocol_version, status, created_at, updated_at) VALUES (?, ?, '', ?, ?, ?, ?, ?, 'active', ?, ?)`)
        .run('6a7d8df7-d495-4f69-9934-dc48ce5ee8d1', 'Test', 'Language', 'Variety', 'Domain', 'City', '1.0', timestamp, timestamp);
      const insertParticipant = db.prepare(`INSERT INTO participants (id, project_id, speaker_code, primary_language,
        status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)`);
      insertParticipant.run('d998bc90-f7d5-4108-900e-aa8951ee7179', '6a7d8df7-d495-4f69-9934-dc48ce5ee8d1', 'SPK-001', 'Language', timestamp, timestamp);
      expect(() => insertParticipant.run('de0a9676-92cc-4b18-997a-3fafce18b700', '6a7d8df7-d495-4f69-9934-dc48ce5ee8d1', 'SPK-001', 'Language', timestamp, timestamp)).toThrow(/UNIQUE/);
      expect(() => insertParticipant.run('0d050af7-474d-4ac7-b1e2-f9e05ecbdc79', '00000000-0000-4000-8000-000000000000', 'SPK-002', 'Language', timestamp, timestamp)).toThrow(/FOREIGN KEY/);
    } finally { db.close(); }
  });
});
