import { describe, expect, it } from 'vitest';

import { sessionDraftSchema, sessionSchema } from './session';

describe('collection session validation', () => {
  it('allows unknown city while requiring an environment', () => {
    const draft = sessionDraftSchema.parse({ collectionEnvironment: 'Indoor shop', city: null, researcherNotes: null, deviceMetadata: { platform: 'android' } });
    expect(draft.city).toBeNull();
  });

  it('requires the exact consent revision that authorized a persisted session', () => {
    const result = sessionSchema.safeParse({
      id: 'de0a9676-92cc-4b18-997a-3fafce18b700', projectId: '6a7d8df7-d495-4f69-9934-dc48ce5ee8d1',
      participantId: 'd998bc90-f7d5-4108-900e-aa8951ee7179', consentRecordId: null,
      startedAt: '2026-09-23T08:00:00.000Z', endedAt: null, deviceMetadata: {}, collectionEnvironment: 'Quiet room',
      city: null, researcherNotes: null, status: 'paused', createdAt: '2026-09-23T08:00:00.000Z', updatedAt: '2026-09-23T08:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});
