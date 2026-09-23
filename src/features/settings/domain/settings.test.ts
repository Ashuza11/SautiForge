import { describe, expect, it } from 'vitest';

import { localSettingsSchema } from './settings';

describe('local settings', () => {
  it('allows no active project and rejects unversioned extra settings', () => {
    expect(localSettingsSchema.parse({ activeProjectId: null })).toEqual({ activeProjectId: null });
    expect(localSettingsSchema.safeParse({ activeProjectId: null, uploadAutomatically: true }).success).toBe(false);
  });
});
