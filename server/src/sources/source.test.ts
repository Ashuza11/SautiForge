import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  NO_AUTHORIZED_USES,
  sourceCandidateBatchSchema,
  sourceMetadataDraftSchema,
  sourceRightsDraftSchema,
} from './source';

describe('source catalogue validation', () => {
  it('supports language-independent authorized source types', () => {
    expect(sourceMetadataDraftSchema.parse({
      sourceType: 'creator_provided',
      title: 'Community-provided narrative',
      originalUrl: null,
      creator: 'Community media group',
      sourceDate: null,
      durationMs: 120_000,
      externalReference: 'permission-file-42',
      languageVerification: 'verified_target',
      languageVerifiedBy: 'REVIEWER-01',
      languageVerificationNotes: 'Verified by two project language reviewers.',
      speakerIdentification: 'unknown',
      speakerNotes: '',
    })).toMatchObject({ title: 'Community-provided narrative' });
  });

  it('requires discovery URLs and SautiForge recording references for their source types', () => {
    const base = {
      title: 'Candidate',
      originalUrl: null,
      creator: null,
      sourceDate: null,
      durationMs: null,
      externalReference: null,
      languageVerification: 'unverified' as const,
      languageVerifiedBy: null,
      languageVerificationNotes: '',
      speakerIdentification: 'not_assessed' as const,
      speakerNotes: '',
    };
    expect(() => sourceMetadataDraftSchema.parse({ ...base, sourceType: 'youtube_reference' })).toThrow(/URL/i);
    expect(() => sourceMetadataDraftSchema.parse({ ...base, sourceType: 'sautiforge_recording' })).toThrow(/recording reference/i);
  });

  it('requires evidence, a rights holder, and explicit uses for approval', () => {
    expect(() => sourceRightsDraftSchema.parse({
      rightsHolder: null,
      license: null,
      permissionEvidence: null,
      attributionRequirements: null,
      authorizedUses: NO_AUTHORIZED_USES,
      decision: 'approved',
      changedBy: 'ADMIN-01',
      changeReason: 'Initial review',
    })).toThrow();
  });

  it('prevents rejected or revoked revisions from retaining permissions', () => {
    expect(() => sourceRightsDraftSchema.parse({
      rightsHolder: 'Rights holder',
      license: null,
      permissionEvidence: 'Restricted permission record P-01',
      attributionRequirements: null,
      authorizedUses: { ...NO_AUTHORIZED_USES, transcription: true },
      decision: 'revoked',
      changedBy: 'ADMIN-01',
      changeReason: 'Permission withdrawn',
    })).toThrow(/cannot authorize/i);
  });

  it('keeps the initial Mashi discovery list as unverified metadata-only candidates', async () => {
    const candidates = sourceCandidateBatchSchema.parse(JSON.parse(await readFile(
      new URL('../../fixtures/mashi-source-candidates.json', import.meta.url),
      'utf8',
    )));
    expect(candidates).toHaveLength(4);
    expect(candidates.every((candidate) => candidate.languageVerification === 'unverified')).toBe(true);
    expect(candidates.every((candidate) => candidate.originalUrl && candidate.durationMs === null)).toBe(true);
  });
});
