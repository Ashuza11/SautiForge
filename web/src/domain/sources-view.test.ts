import { describe, expect, it } from 'vitest';

import { blankRightsForm, blankSourceForm, buildRightsDraft, buildSourceDraft, publishCommand } from './sources-view';

describe('source form helpers', () => {
  it('builds a source from plain form text, converting minutes to milliseconds', () => {
    const built = buildSourceDraft({
      ...blankSourceForm,
      title: ' Invitation to Know Jesus Personally (Mashi) ',
      originalUrl: 'https://www.jesusfilm.org/watch/x',
      creator: 'Jesus Film Project',
      durationMinutes: '6.7',
      languageVerification: 'verified_target',
      languageVerifiedBy: 'ADMIN-01',
    });
    expect(built).toMatchObject({ ok: true, value: { title: 'Invitation to Know Jesus Personally (Mashi)', durationMs: 402_000, externalReference: null } });
  });

  it('asks for a link on website sources, https only, and a reviewer once a language was checked', () => {
    expect(buildSourceDraft({ ...blankSourceForm, title: 'x' })).toMatchObject({ ok: false, errors: { originalUrl: expect.any(String) } });
    expect(buildSourceDraft({ ...blankSourceForm, title: 'x', originalUrl: 'http://a.org' })).toMatchObject({ ok: false });
    expect(buildSourceDraft({ ...blankSourceForm, title: 'x', originalUrl: 'https://a.org', languageVerification: 'verified_target' }))
      .toMatchObject({ ok: false, errors: { languageVerifiedBy: expect.any(String) } });
    expect(buildSourceDraft({ ...blankSourceForm, title: 'x', originalUrl: 'https://a.org', durationMinutes: 'abc' })).toMatchObject({ ok: false });
  });

  it('starts the rights form with nothing approved and allowed', () => {
    expect(blankRightsForm.decision).toBe('pending');
    expect(Object.values(blankRightsForm.authorizedUses).some(Boolean)).toBe(false);
  });

  it('never accepts an approval without a holder, evidence and at least one use', () => {
    const base = { ...blankRightsForm, decision: 'approved' as const, changedBy: 'ADMIN-01', changeReason: 'Community decision' };
    const missing = buildRightsDraft(base);
    expect(missing).toMatchObject({ ok: false, errors: { rightsHolder: expect.any(String), permissionEvidence: expect.any(String), authorizedUses: expect.any(String) } });
    expect(buildRightsDraft({
      ...base,
      rightsHolder: 'Community',
      permissionEvidence: 'Recorded consent',
      authorizedUses: { ...base.authorizedUses, internalProcessing: true, volunteerAccess: true, transcription: true },
    }).ok).toBe(true);
  });

  it('refuses allowed uses on a refused or withdrawn decision', () => {
    const uses = { ...blankRightsForm.authorizedUses, mlResearch: true };
    expect(buildRightsDraft({ ...blankRightsForm, decision: 'rejected', authorizedUses: uses, changedBy: 'ADMIN-01', changeReason: 'No' }).ok).toBe(false);
  });

  it('gives a copyable publish command with the source id', () => {
    expect(publishCommand('abc', 'https://site.vercel.app')).toContain('--source-id abc');
  });
});
