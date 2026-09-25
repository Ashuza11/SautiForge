import { validateRelativeArchivePath } from './manifest';

export const RESTORE_SPACE_RESERVE_BYTES = 25 * 1024 * 1024;
export const MAX_BACKUP_ENTRIES = 100_000;

export type BackupArchiveEntry = {
  path: string;
  size: number;
  compressedSize: number;
  isDirectory: boolean;
  isEncrypted: boolean;
};

function safeBytes(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Backup contains an invalid ${label}.`);
  return value;
}

export function requireArchiveCopySpace(archiveBytes: number | null, availableBytes: number): void {
  safeBytes(availableBytes, 'available storage value');
  if (archiveBytes === null) return;
  safeBytes(archiveBytes, 'archive size');
  if (availableBytes < archiveBytes + RESTORE_SPACE_RESERVE_BYTES) {
    throw new Error('Not enough free storage to copy the selected backup safely.');
  }
}

export function validateRestoreArchive(
  entries: BackupArchiveEntry[],
  availableBytes: number,
  currentRecordingBytes: number,
): { fileCount: number; uncompressedBytes: number; requiredBytes: number } {
  safeBytes(availableBytes, 'available storage value');
  safeBytes(currentRecordingBytes, 'current recording size');
  if (!entries.length) throw new Error('Backup archive is empty.');
  if (entries.length > MAX_BACKUP_ENTRIES) throw new Error(`Backup contains more than ${MAX_BACKUP_ENTRIES} entries.`);

  const paths = new Set<string>();
  let uncompressedBytes = 0;
  let fileCount = 0;
  for (const entry of entries) {
    const normalized = entry.path.replace(/\/$/, '');
    if (!validateRelativeArchivePath(normalized)) throw new Error(`Backup contains an unsafe path: ${entry.path}`);
    if (paths.has(normalized)) throw new Error(`Backup contains a duplicate path: ${normalized}`);
    paths.add(normalized);
    if (entry.isEncrypted) throw new Error(`Encrypted backup members are not supported: ${normalized}`);
    safeBytes(entry.size, `uncompressed size for ${normalized}`);
    safeBytes(entry.compressedSize, `compressed size for ${normalized}`);
    if (!entry.isDirectory) {
      fileCount += 1;
      uncompressedBytes += entry.size;
      if (!Number.isSafeInteger(uncompressedBytes)) throw new Error('Backup expanded size is too large to validate safely.');
    }
  }

  const requiredBytes = uncompressedBytes * 2 + currentRecordingBytes + RESTORE_SPACE_RESERVE_BYTES;
  if (!Number.isSafeInteger(requiredBytes) || availableBytes < requiredBytes) {
    throw new Error('Not enough free storage to extract, verify, and roll back this backup safely.');
  }
  return { fileCount, uncompressedBytes, requiredBytes };
}

export function validateBackupMemberSet(manifestPaths: string[], archiveFilePaths: string[]): void {
  const expected = new Set(['manifest.json', ...manifestPaths]);
  const actual = new Set(archiveFilePaths);
  if (actual.size !== archiveFilePaths.length) throw new Error('Backup contains duplicate file members.');
  for (const path of expected) if (!actual.has(path)) throw new Error(`Backup archive is missing declared member: ${path}`);
  for (const path of actual) if (!expected.has(path)) throw new Error(`Backup archive contains undeclared member: ${path}`);
}
