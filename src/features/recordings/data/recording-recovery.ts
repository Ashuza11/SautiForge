import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { nowIso } from '@/domain/common';
import { storageRecoveryReportSchema, type StorageRecoveryReport } from '@/features/settings/domain/settings';
import { classifyRecordingFiles, type StoredFileDescription } from '../domain/recovery';

function listRecordingFiles(directory: Directory, prefix = 'recordings'): StoredFileDescription[] {
  if (!directory.exists) return [];
  return directory.list().flatMap((entry) => {
    const relativePath = `${prefix}/${entry.name}`;
    return entry instanceof Directory ? listRecordingFiles(entry, relativePath) : [{ path: relativePath, size: entry.size ?? 0 }];
  });
}

function ensureParent(root: Directory, relativePath: string): void {
  const segments = relativePath.split('/');
  segments.pop();
  if (segments.length) new Directory(root, ...segments).create({ intermediates: true, idempotent: true });
}

export async function recoverRecordingStorage(db: SQLiteDatabase): Promise<StorageRecoveryReport> {
  const checkedAt = nowIso();
  const errors: string[] = [];
  const rows = await db.getAllAsync<{ relative_audio_path: string }>('SELECT relative_audio_path FROM recordings');
  const storedFiles = listRecordingFiles(new Directory(Paths.document, 'recordings'));
  const classification = classifyRecordingFiles(rows.map((row) => row.relative_audio_path), storedFiles);
  const quarantinedPaths: string[] = [];
  if (classification.quarantinedPaths.length) {
    const quarantine = new Directory(Paths.document, 'recovery', 'orphaned-recordings', checkedAt.replaceAll(':', '-'));
    quarantine.create({ intermediates: true, idempotent: true });
    for (const relativePath of classification.quarantinedPaths) {
      try {
        const source = new File(Paths.document, relativePath);
        ensureParent(quarantine, relativePath);
        await source.move(new File(quarantine, relativePath));
        quarantinedPaths.push(relativePath);
      } catch (cause) {
        errors.push(`${relativePath}: ${cause instanceof Error ? cause.message : 'could not be quarantined'}`);
      }
    }
  }
  const report = storageRecoveryReportSchema.parse({
    checkedAt, scannedFiles: storedFiles.length, verifiedFiles: classification.verifiedFiles,
    quarantinedPaths, missingPaths: classification.missingPaths, errors,
  });
  await db.runAsync(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('last_storage_recovery', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    JSON.stringify(report), checkedAt,
  );
  return report;
}
