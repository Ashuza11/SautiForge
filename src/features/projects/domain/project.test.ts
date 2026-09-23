import { describe, expect, it } from 'vitest';

import { projectDraftSchema } from './project';

describe('projectDraftSchema', () => {
  const valid = {
    title: 'Community speech pilot',
    description: '',
    targetLanguage: 'Mashi',
    languageVariety: 'Bukavu variety',
    researchDomain: 'Public health',
    collectionLocation: 'Bukavu, DRC',
    protocolVersion: '1.0',
    status: 'active' as const,
  };

  it('accepts a reusable research project', () => {
    expect(projectDraftSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a missing target language', () => {
    expect(projectDraftSchema.safeParse({ ...valid, targetLanguage: ' ' }).success).toBe(false);
  });
});
