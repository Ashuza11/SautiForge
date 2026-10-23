import { describe, expect, it } from 'vitest';

import { projectDraftSchema } from './project';

describe('projectDraftSchema', () => {
  const valid = {
    title: 'Community speech pilot',
    description: '',
    targetLanguage: 'Mashi',
    languageCode: 'shr',
    languageVariety: 'Bukavu variety',
    researchDomain: 'Public health',
    collectionLocation: 'Bukavu, DRC',
    protocolVersion: '1.0',
    annotationProfile: 'verbatim_transcription' as const,
    status: 'active' as const,
  };

  it('accepts a reusable research project', () => {
    expect(projectDraftSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a missing target language', () => {
    expect(projectDraftSchema.safeParse({ ...valid, targetLanguage: ' ' }).success).toBe(false);
  });

  it('requires an ISO 639-3 code and a supported annotation profile', () => {
    expect(projectDraftSchema.safeParse({ ...valid, languageCode: 'mho' }).success).toBe(true);
    expect(projectDraftSchema.safeParse({ ...valid, languageCode: 'shi' }).success).toBe(true);
    expect(projectDraftSchema.safeParse({ ...valid, languageCode: 'sw' }).success).toBe(false);
    expect(projectDraftSchema.safeParse({ ...valid, annotationProfile: 'business_transaction' }).success).toBe(true);
    expect(projectDraftSchema.safeParse({ ...valid, annotationProfile: 'automatic_asr' }).success).toBe(false);
  });
});
