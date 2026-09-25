import { describe, expect, it } from 'vitest';

import { requireArchiveCopySpace, RESTORE_SPACE_RESERVE_BYTES, validateBackupMemberSet, validateRestoreArchive } from './restore-preflight';

const entries = [
  { path: 'manifest.json', size: 500, compressedSize: 250, isDirectory: false, isEncrypted: false },
  { path: 'database.sqlite', size: 2_000, compressedSize: 1_000, isDirectory: false, isEncrypted: false },
  { path: 'recordings/project/', size: 0, compressedSize: 0, isDirectory: true, isEncrypted: false },
  { path: 'recordings/project/take.m4a', size: 10_000, compressedSize: 9_000, isDirectory: false, isEncrypted: false },
];

describe('backup restore preflight', () => {
  it('calculates conservative extraction, destination, rollback, and reserve space', () => {
    const result = validateRestoreArchive(entries, 100_000_000, 5_000);
    expect(result).toEqual({
      fileCount: 3,
      uncompressedBytes: 12_500,
      requiredBytes: 25_000 + 5_000 + RESTORE_SPACE_RESERVE_BYTES,
    });
  });

  it('rejects insufficient copy or restore capacity before extraction', () => {
    expect(() => requireArchiveCopySpace(50_000_000, 50_000_000)).toThrow(/Not enough free storage/);
    expect(() => validateRestoreArchive(entries, RESTORE_SPACE_RESERVE_BYTES, 0)).toThrow(/Not enough free storage/);
  });

  it('rejects unsafe, duplicate, encrypted, and invalid-size entries', () => {
    expect(() => validateRestoreArchive([{ ...entries[0], path: '../private.db' }], 100_000_000, 0)).toThrow(/unsafe path/);
    expect(() => validateRestoreArchive([entries[0], entries[0]], 100_000_000, 0)).toThrow(/duplicate path/);
    expect(() => validateRestoreArchive([{ ...entries[0], isEncrypted: true }], 100_000_000, 0)).toThrow(/Encrypted/);
    expect(() => validateRestoreArchive([{ ...entries[0], size: -1 }], 100_000_000, 0)).toThrow(/invalid uncompressed size/);
  });

  it('requires the archive file set to match the manifest exactly', () => {
    expect(() => validateBackupMemberSet(['database.sqlite', 'recordings/take.m4a'], [
      'manifest.json', 'database.sqlite', 'recordings/take.m4a',
    ])).not.toThrow();
    expect(() => validateBackupMemberSet(['database.sqlite'], ['manifest.json', 'database.sqlite', 'private.txt']))
      .toThrow(/undeclared member/);
    expect(() => validateBackupMemberSet(['database.sqlite', 'recordings/missing.m4a'], ['manifest.json', 'database.sqlite']))
      .toThrow(/missing declared member/);
  });
});
