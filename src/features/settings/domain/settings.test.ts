import { describe, expect, it } from 'vitest';

import { localSettingsSchema, storageRecoveryReportSchema } from './settings';

describe('local settings', () => {
  it('allows no active project and rejects unversioned extra settings', () => {
    expect(localSettingsSchema.parse({ activeProjectId: null })).toEqual({ activeProjectId: null });
    expect(localSettingsSchema.safeParse({ activeProjectId: null, uploadAutomatically: true }).success).toBe(false);
  });

  it('validates persistent recovery results', () => {
    expect(storageRecoveryReportSchema.parse({ checkedAt: '2026-09-23T08:00:00.000Z', scannedFiles: 2, verifiedFiles: 1, quarantinedPaths: ['recordings/project/orphan.m4a'], missingPaths: [], errors: [] }).quarantinedPaths).toHaveLength(1);
  });
});
