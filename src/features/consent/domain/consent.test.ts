import { describe, expect, it } from 'vitest';

import { canRecord, consentRecordSchema, permitsSharing } from './consent';

const granted = consentRecordSchema.parse({
  id: '8df0a8f5-d31e-4dc4-b60c-1879927c18d7',
  participantId: 'd998bc90-f7d5-4108-900e-aa8951ee7179',
  status: 'granted',
  internalResearch: true,
  restrictedAnnotation: true,
  publicRelease: false,
  recordedBy: null,
  consentedAt: '2026-09-23T08:00:00.000Z',
  validUntil: null,
  supersedesId: null,
  notes: null,
  consentProtocolVersion: '1.0',
  createdAt: '2026-09-23T08:00:00.000Z',
});

describe('consent authorization', () => {
  it('allows recording only with granted internal-research consent', () => {
    expect(canRecord(granted)).toBe(true);
    expect(canRecord({ ...granted, status: 'withdrawn' })).toBe(false);
    expect(canRecord({ ...granted, internalResearch: false })).toBe(false);
  });

  it('honors consent expiry', () => {
    expect(canRecord({ ...granted, validUntil: '2026-09-22T00:00:00.000Z' }, new Date('2026-09-23T00:00:00.000Z'))).toBe(false);
  });

  it('blocks exports beyond the approved sharing category', () => {
    expect(permitsSharing(granted, 'restricted_annotation')).toBe(true);
    expect(permitsSharing(granted, 'public_release')).toBe(false);
  });
});
