import { Directory, File, Paths } from 'expo-file-system';
import { shareAsync, isAvailableAsync } from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';
import { backupDatabaseAsync, deserializeDatabaseAsync } from 'expo-sqlite';
import { listContents, unzip, zip } from 'react-native-zip-archive';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { DATABASE_OPEN_PRAGMAS, DATABASE_VERSION } from '@/core/database/migrations';
import { newId, nowIso } from '@/domain/common';
import type { ConsentRepository } from '@/features/consent/data/consent-repository';
import type { SharingCategory } from '@/features/consent/domain/consent';
import { getRecordingFile } from '@/features/recordings/data/audio-file-store';
import { EXPORT_SCHEMA_VERSION, exportManifestSchema, validateManifestReferences, validateRelativeArchivePath, type ExportManifest } from '../domain/manifest';

type ExportResult = { archive: File; exportId: string; includedRecordings: number; excludedRecordings: number };

type RecordingExportRow = Record<string, unknown> & {
  id: string; participant_id: string; relative_audio_path: string; container: string;
};

function nativePath(uri: string): string {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice(7)) : uri;
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project';
}

function jsonLine(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}

function writeText(directory: Directory, name: string, content: string): File {
  const file = new File(directory, name);
  file.create({ overwrite: true, intermediates: true });
  file.write(content);
  return file;
}

async function hashFile(file: File): Promise<string> {
  const digest = sha256.create();
  const reader = file.readableStream().getReader();
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    digest.update(part.value);
  }
  return bytesToHex(digest.digest());
}

async function describeFile(root: Directory, relativePath: string) {
  const file = new File(root, relativePath);
  if (!file.exists || file.size === null) throw new Error(`Export file is missing: ${relativePath}`);
  return { path: relativePath, sizeBytes: file.size, sha256: await hashFile(file) };
}

function ensureRelativeParent(root: Directory, relativePath: string): void {
  const segments = relativePath.split('/');
  segments.pop();
  if (segments.length) new Directory(root, ...segments).create({ intermediates: true, idempotent: true });
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return `${headers.map(csvCell).join(',')}\n${rows.map((row) => headers.map((key) => csvCell(row[key])).join(',')).join('\n')}\n`;
}

async function verifyArchive(archive: File, expectedFiles: Array<{ path: string; sizeBytes: number; sha256: string }>): Promise<void> {
  if (!archive.exists || !archive.size || archive.size <= 0) throw new Error('ZIP archive was not created or is empty.');
  const entries = await listContents(nativePath(archive.uri));
  const paths = entries.filter((entry) => !entry.isDirectory).map((entry) => entry.path);
  for (const expected of expectedFiles) {
    if (!paths.some((path) => path === expected.path || path.endsWith(`/${expected.path}`))) {
      throw new Error(`ZIP validation failed: ${expected.path} is missing.`);
    }
  }
  const verification = new Directory(Paths.cache, `verify-${newId()}`);
  verification.create({ intermediates: true });
  try {
    await unzip(nativePath(archive.uri), nativePath(verification.uri));
    for (const expected of expectedFiles) {
      const actual = await describeFile(verification, expected.path);
      if (actual.sizeBytes !== expected.sizeBytes || actual.sha256 !== expected.sha256) {
        throw new Error(`ZIP integrity validation failed for ${expected.path}.`);
      }
    }
  } finally {
    if (verification.exists) verification.delete();
  }
}

export class ExportService {
  constructor(private readonly db: SQLiteDatabase, private readonly consent: ConsentRepository) {}

  async createResearchDataset(projectId: string, category: SharingCategory): Promise<ExportResult> {
    const project = await this.db.getFirstAsync<Record<string, unknown> & { id: string; title: string }>(
      `SELECT id, title, description, target_language, language_variety, research_domain, collection_location,
       protocol_version, status, created_at, updated_at FROM projects WHERE id = ?`, projectId,
    );
    if (!project) throw new Error('Project not found.');
    const allRecordings = await this.db.getAllAsync<RecordingExportRow>(
      `SELECT id, display_id, project_id, session_id, participant_id, scenario_id, scenario_version,
       scenario_prompt_snapshot_json, collection_method, recorded_at, duration_ms, file_size_bytes, container, codec,
       sample_rate_hz, channel_count, spoken_languages_json, language_variety, code_switching_status,
       recording_environment, noise_level, quality_rating, notes, annotation_status, created_at, updated_at,
       relative_audio_path FROM recordings WHERE project_id = ? AND archived_at IS NULL ORDER BY recorded_at`, projectId,
    );
    const eligible: RecordingExportRow[] = [];
    for (const recording of allRecordings) {
      if (await this.consent.participantPermitsSharing(recording.participant_id, category)) eligible.push(recording);
    }
    if (!eligible.length) throw new Error(`No recordings are currently approved for ${category.replaceAll('_', ' ')} export.`);

    const estimatedBytes = eligible.reduce((total, item) => total + Number(item.file_size_bytes ?? 0), 0);
    if (Paths.availableDiskSpace < estimatedBytes * 3 + 25 * 1024 * 1024) {
      throw new Error('Not enough free storage to stage and validate this export. Free space and try again.');
    }

    const exportId = newId();
    const timestamp = nowIso();
    const archiveName = `sautiforge-${safeName(project.title)}-${timestamp.slice(0, 10)}-${exportId.slice(0, 8)}.zip`;
    await this.startHistory(exportId, projectId, 'research_dataset', category, archiveName, timestamp);
    const staging = new Directory(Paths.cache, `export-${exportId}`);
    const archive = new File(Paths.cache, archiveName);
    try {
      staging.create({ idempotent: false, intermediates: true });
      const metadata = new Directory(staging, 'metadata');
      const audio = new Directory(staging, 'audio');
      metadata.create({ intermediates: true });
      audio.create({ intermediates: true });

      const participantIds = [...new Set(eligible.map((item) => item.participant_id))];
      const sessionIds = [...new Set(eligible.map((item) => String(item.session_id)))];
      const recordingIds = eligible.map((item) => item.id);
      const placeholders = (values: unknown[]) => values.map(() => '?').join(',');
      const participants = await this.db.getAllAsync<Record<string, unknown>>(
        `SELECT id, project_id, speaker_code, primary_language, language_variety, other_languages_json,
         age_bracket, gender_self_described, business_category, years_business_experience, status, created_at, updated_at
         FROM participants WHERE id IN (${placeholders(participantIds)})`, ...participantIds,
      );
      const sessions = await this.db.getAllAsync<Record<string, unknown>>(
        `SELECT id, project_id, participant_id, started_at, ended_at, device_metadata_json, collection_environment,
         city, status, created_at, updated_at FROM sessions WHERE id IN (${placeholders(sessionIds)})`, ...sessionIds,
      );
      const scenarios = await this.db.getAllAsync<Record<string, unknown>>(
        `SELECT id, project_id, title, description, collection_instructions, expected_intent, collection_method,
         version, reference_data_json, status, created_at, updated_at FROM scenarios WHERE project_id = ?`, projectId,
      );
      const transcriptions = await this.db.getAllAsync<Record<string, unknown>>(
        `SELECT id, recording_id, verbatim_text, normalized_text, language_tags_json, notes, source,
         revision_number, supersedes_id, created_at, created_by FROM transcriptions
         WHERE recording_id IN (${placeholders(recordingIds)}) ORDER BY recording_id, revision_number`, ...recordingIds,
      );
      const annotations = await this.db.getAllAsync<Record<string, unknown>>(
        `SELECT id, recording_id, annotation_type, schema_version, payload_json, source, revision_number,
         supersedes_id, created_at, created_by FROM annotations
         WHERE recording_id IN (${placeholders(recordingIds)}) ORDER BY recording_id, annotation_type, revision_number`, ...recordingIds,
      );

      const exportedRecordings: Record<string, unknown>[] = [];
      const filePaths: string[] = [];
      for (const recording of eligible) {
        const name = recording.relative_audio_path.split('/').at(-1) ?? '';
        const extension = name.includes('.') ? `.${name.split('.').at(-1)}` : `.${recording.container}`;
        const relativePath = `audio/${recording.id}${extension}`;
        const source = getRecordingFile(recording.relative_audio_path);
        const destination = new File(staging, relativePath);
        await source.copy(destination);
        if (!destination.exists || destination.size !== source.size) throw new Error(`Audio copy could not be verified for ${recording.id}.`);
        const { relative_audio_path: _privatePath, ...portable } = recording;
        exportedRecordings.push({ ...portable, audio_path: relativePath });
        filePaths.push(relativePath);
      }

      const documents: Array<[string, string]> = [
        ['metadata/project.json', `${JSON.stringify(project, null, 2)}\n`],
        ['metadata/scenarios.jsonl', jsonLine(scenarios)],
        ['metadata/participants.jsonl', jsonLine(participants)],
        ['metadata/participants.csv', rowsToCsv(participants)],
        ['metadata/sessions.jsonl', jsonLine(sessions)],
        ['metadata/recordings.jsonl', jsonLine(exportedRecordings)],
        ['metadata/transcriptions.jsonl', jsonLine(transcriptions)],
        ['metadata/annotations.jsonl', jsonLine(annotations)],
      ];
      for (const [path, contents] of documents) { writeText(staging, path, contents); filePaths.push(path); }
      const files = await Promise.all(filePaths.map((path) => describeFile(staging, path)));
      const manifest = exportManifestSchema.parse({
        schemaVersion: EXPORT_SCHEMA_VERSION, exportId, exportType: 'research_dataset', exportedAt: timestamp,
        app: 'SautiForge', databaseVersion: DATABASE_VERSION, projectId, sharingCategory: category,
        sensitiveAdministrativeData: false,
        counts: { projects: 1, scenarios: scenarios.length, participants: participants.length, sessions: sessions.length,
          recordings: eligible.length, transcriptions: transcriptions.length, annotations: annotations.length,
          recordingsExcludedByConsent: allRecordings.length - eligible.length }, files,
      });
      validateManifestReferences(manifest, exportedRecordings.map((item) => String(item.audio_path)));
      writeText(staging, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
      const manifestDescription = await describeFile(staging, 'manifest.json');
      if (archive.exists) archive.delete();
      await zip(nativePath(staging.uri), nativePath(archive.uri), { compressionLevel: 6 });
      await verifyArchive(archive, [manifestDescription, ...files]);
      const manifestHash = manifestDescription.sha256;
      await this.completeHistory(exportId, archive, manifestHash);
      staging.delete();
      return { archive, exportId, includedRecordings: eligible.length, excludedRecordings: allRecordings.length - eligible.length };
    } catch (cause) {
      if (staging.exists) staging.delete();
      if (archive.exists) archive.delete();
      await this.failHistory(exportId, cause);
      throw cause;
    }
  }

  async createAdministrativeBackup(): Promise<ExportResult> {
    const exportId = newId();
    const timestamp = nowIso();
    const archiveName = `sautiforge-private-backup-${timestamp.slice(0, 10)}-${exportId.slice(0, 8)}.zip`;
    await this.startHistory(exportId, null, 'administrative_backup', null, archiveName, timestamp);
    const staging = new Directory(Paths.cache, `backup-${exportId}`);
    const archive = new File(Paths.cache, archiveName);
    try {
      staging.create({ intermediates: true });
      const bytes = await this.db.serializeAsync();
      const recordingBytes = (await this.db.getFirstAsync<{ total: number }>('SELECT COALESCE(SUM(file_size_bytes), 0) AS total FROM recordings'))?.total ?? 0;
      if (Paths.availableDiskSpace < (bytes.byteLength + recordingBytes) * 3 + 25 * 1024 * 1024) {
        throw new Error('Not enough free storage to create and verify a complete administrative backup.');
      }
      const databaseFile = new File(staging, 'database.sqlite');
      databaseFile.create({ overwrite: true });
      databaseFile.write(bytes);
      const recordings = await this.db.getAllAsync<{ relative_audio_path: string }>('SELECT relative_audio_path FROM recordings');
      const paths = ['database.sqlite'];
      for (const { relative_audio_path: relativePath } of recordings) {
        if (!validateRelativeArchivePath(relativePath) || !relativePath.startsWith('recordings/')) {
          throw new Error(`Unsafe stored recording path: ${relativePath}`);
        }
        const source = getRecordingFile(relativePath);
        const destination = new File(staging, relativePath);
        ensureRelativeParent(staging, relativePath);
        await source.copy(destination);
        paths.push(relativePath);
      }
      const files = await Promise.all(paths.map((path) => describeFile(staging, path)));
      const manifest = exportManifestSchema.parse({
        schemaVersion: EXPORT_SCHEMA_VERSION, exportId, exportType: 'administrative_backup', exportedAt: timestamp,
        app: 'SautiForge', databaseVersion: DATABASE_VERSION, projectId: null, sharingCategory: null,
        sensitiveAdministrativeData: true, counts: { recordings: recordings.length }, files,
      });
      writeText(staging, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
      const manifestDescription = await describeFile(staging, 'manifest.json');
      if (archive.exists) archive.delete();
      await zip(nativePath(staging.uri), nativePath(archive.uri), { compressionLevel: 6 });
      await verifyArchive(archive, [manifestDescription, ...files]);
      const manifestHash = manifestDescription.sha256;
      await this.completeHistory(exportId, archive, manifestHash);
      staging.delete();
      return { archive, exportId, includedRecordings: recordings.length, excludedRecordings: 0 };
    } catch (cause) {
      if (staging.exists) staging.delete();
      if (archive.exists) archive.delete();
      await this.failHistory(exportId, cause);
      throw cause;
    }
  }

  async saveOutsideApp(archive: File, exportId: string): Promise<string> {
    const directory = await Directory.pickDirectoryAsync();
    const destination = new File(directory, archive.name);
    await archive.copy(destination, { overwrite: true });
    if (!destination.exists || destination.size !== archive.size) throw new Error('The exported ZIP could not be verified at the selected destination.');
    await this.db.runAsync('UPDATE export_history SET destination_uri = ? WHERE id = ?', destination.uri, exportId);
    return destination.uri;
  }

  async share(archive: File): Promise<void> {
    if (!(await isAvailableAsync())) throw new Error('The Android sharing interface is unavailable on this device.');
    await shareAsync(archive.uri, { mimeType: 'application/zip', dialogTitle: 'Share SautiForge archive' });
  }

  async pickAndRestoreAdministrativeBackup(): Promise<{ recordings: number }> {
    const picked = await File.pickFileAsync({ mimeTypes: ['application/zip', 'application/x-zip-compressed'] });
    if (picked.canceled) throw new Error('Backup selection was cancelled.');
    const selected = picked.result;
    const localZip = new File(Paths.cache, `restore-${newId()}.zip`);
    await selected.copy(localZip, { overwrite: true });
    const entries = await listContents(nativePath(localZip.uri));
    if (entries.some((entry) => !validateRelativeArchivePath(entry.path.replace(/\/$/, '')))) throw new Error('Backup contains an unsafe path.');
    const staging = new Directory(Paths.cache, `restore-${newId()}`);
    staging.create({ intermediates: true });
    try {
      await unzip(nativePath(localZip.uri), nativePath(staging.uri));
      const manifestFile = new File(staging, 'manifest.json');
      if (!manifestFile.exists) throw new Error('Backup manifest is missing.');
      const manifest = exportManifestSchema.parse(await manifestFile.json()) as ExportManifest;
      if (manifest.exportType !== 'administrative_backup' || !manifest.sensitiveAdministrativeData) throw new Error('This is not an administrative backup.');
      if (manifest.databaseVersion !== DATABASE_VERSION) throw new Error(`Backup database version ${manifest.databaseVersion} is not supported by this app version.`);
      validateManifestReferences(manifest, []);
      for (const expected of manifest.files) {
        const actual = await describeFile(staging, expected.path);
        if (actual.sizeBytes !== expected.sizeBytes || actual.sha256 !== expected.sha256) throw new Error(`Backup integrity check failed for ${expected.path}.`);
      }
      const databaseFile = new File(staging, 'database.sqlite');
      const restored = await deserializeDatabaseAsync(new Uint8Array(await databaseFile.arrayBuffer()));
      try {
        const integrity = await restored.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
        const foreignKeys = await restored.getAllAsync('PRAGMA foreign_key_check');
        if (integrity?.integrity_check !== 'ok' || foreignKeys.length) throw new Error('The restored database failed integrity checks.');
        const version = await restored.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
        if (version?.user_version !== DATABASE_VERSION) throw new Error('The restored database schema is incompatible.');
        const audioRows = await restored.getAllAsync<{ relative_audio_path: string }>('SELECT relative_audio_path FROM recordings');
        validateManifestReferences(manifest, audioRows.map((row) => row.relative_audio_path));
        for (const row of audioRows) {
          const source = new File(staging, row.relative_audio_path);
          if (!source.exists || !row.relative_audio_path.startsWith('recordings/')) throw new Error(`Backup audio is missing or unsafe: ${row.relative_audio_path}`);
        }
        const currentDatabase = await this.db.serializeAsync();
        const rollback = new Directory(Paths.cache, `rollback-${newId()}`);
        rollback.create({ intermediates: true });
        const previouslyExisting = new Set<string>();
        try {
          for (const row of audioRows) {
            const destination = new File(Paths.document, row.relative_audio_path);
            if (destination.exists) {
              previouslyExisting.add(row.relative_audio_path);
              ensureRelativeParent(rollback, row.relative_audio_path);
              await destination.copy(new File(rollback, row.relative_audio_path));
            }
            ensureRelativeParent(Paths.document, row.relative_audio_path);
            await new File(staging, row.relative_audio_path).copy(destination, { overwrite: true });
            const expected = manifest.files.find((file) => file.path === row.relative_audio_path);
            const actual = await describeFile(Paths.document, row.relative_audio_path);
            if (!expected || expected.sha256 !== actual.sha256 || expected.sizeBytes !== actual.sizeBytes) {
              throw new Error(`Restored audio could not be verified: ${row.relative_audio_path}`);
            }
          }
          await backupDatabaseAsync({ sourceDatabase: restored, destDatabase: this.db });
          await this.db.execAsync(DATABASE_OPEN_PRAGMAS);
        } catch (cause) {
          for (const row of audioRows) {
            const destination = new File(Paths.document, row.relative_audio_path);
            if (previouslyExisting.has(row.relative_audio_path)) {
              await new File(rollback, row.relative_audio_path).copy(destination, { overwrite: true });
            } else if (destination.exists) destination.delete();
          }
          const rollbackDatabase = await deserializeDatabaseAsync(currentDatabase);
          try { await backupDatabaseAsync({ sourceDatabase: rollbackDatabase, destDatabase: this.db }); }
          finally { await rollbackDatabase.closeAsync(); }
          await this.db.execAsync(DATABASE_OPEN_PRAGMAS);
          throw cause;
        } finally {
          if (rollback.exists) rollback.delete();
        }
        return { recordings: audioRows.length };
      } finally {
        await restored.closeAsync();
      }
    } finally {
      if (staging.exists) staging.delete();
      if (localZip.exists) localZip.delete();
    }
  }

  private async startHistory(id: string, projectId: string | null, type: string, category: string | null, name: string, at: string) {
    await this.db.runAsync(
      `INSERT INTO export_history (id, project_id, export_type, sharing_category, schema_version, archive_file_name, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'started', ?)`, id, projectId, type, category, EXPORT_SCHEMA_VERSION, name, at,
    );
  }

  private async completeHistory(id: string, archive: File, manifestHash: string) {
    await this.db.runAsync(
      `UPDATE export_history SET status = 'completed', archive_size_bytes = ?, manifest_hash = ?, completed_at = ? WHERE id = ?`,
      archive.size, manifestHash, nowIso(), id,
    );
  }

  private async failHistory(id: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Unknown export failure';
    await this.db.runAsync(`UPDATE export_history SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`, message, nowIso(), id);
  }
}
