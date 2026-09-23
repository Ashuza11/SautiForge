import { describe, expect, it } from 'vitest';

import { EXPORT_SCHEMA_VERSION, exportManifestSchema, validateManifestReferences, validateRelativeArchivePath } from './manifest';

const manifest = exportManifestSchema.parse({
  schemaVersion: EXPORT_SCHEMA_VERSION,
  exportId: '0d050af7-474d-4ac7-b1e2-f9e05ecbdc79',
  exportType: 'research_dataset',
  exportedAt: '2026-09-23T10:00:00.000Z',
  app: 'SautiForge',
  databaseVersion: 3,
  projectId: '6a7d8df7-d495-4f69-9934-dc48ce5ee8d1',
  sharingCategory: 'internal_research',
  sensitiveAdministrativeData: false,
  counts: { recordings: 1 },
  files: [{ path: 'audio/example.m4a', sizeBytes: 42, sha256: 'a'.repeat(64) }],
});

describe('export manifest', () => {
  it('accepts an internally consistent audio reference', () => {
    expect(() => validateManifestReferences(manifest, ['audio/example.m4a'])).not.toThrow();
  });

  it('rejects missing audio and unsafe paths', () => {
    expect(() => validateManifestReferences(manifest, ['audio/missing.m4a'])).toThrow(/does not contain/);
    expect(validateRelativeArchivePath('../private.db')).toBe(false);
    expect(validateRelativeArchivePath('audio\\private.m4a')).toBe(false);
  });
});
