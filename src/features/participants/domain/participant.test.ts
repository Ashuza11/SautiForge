import { describe, expect, it } from 'vitest';

import { participantDraftSchema, speakerCodeFromId } from './participant';

const valid = {
  speakerCode: 'SPK-001', primaryLanguage: 'Kingwana', languageVariety: 'Bukavu', otherLanguages: ['French'],
  ageBracket: null, genderSelfDescribed: null, businessCategory: 'Telecom retail', yearsBusinessExperience: 4,
  researchNotes: null, status: 'active' as const,
};

describe('participant validation', () => {
  it('accepts pseudonymous metadata without requiring direct identifiers', () => {
    expect(participantDraftSchema.parse(valid).speakerCode).toBe('SPK-001');
  });

  it('rejects impossible experience and empty speaker IDs', () => {
    expect(participantDraftSchema.safeParse({ ...valid, yearsBusinessExperience: -1 }).success).toBe(false);
    expect(participantDraftSchema.safeParse({ ...valid, speakerCode: ' ' }).success).toBe(false);
  });

  it('derives a stable pseudonymous display code from a random ID', () => {
    expect(speakerCodeFromId('de0a9676-92cc-4b18-997a-3fafce18b700')).toBe('SPK-DE0A967692CC');
    expect(() => speakerCodeFromId('participant-name')).toThrow(/valid random ID/);
  });
});
