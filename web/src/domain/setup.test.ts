import { describe, expect, it } from 'vitest';

import { buildPermission, buildProject, buildSource, PERMISSION_TEXT } from './setup';

const mashi = { name: 'Mashi speech corpus', language: 'mashi' as const, otherLanguage: '', otherCode: '' };

describe('setup answers', () => {
  it('turns a name and the Mashi choice into a full project', () => {
    expect(buildProject(mashi)).toMatchObject({
      ok: true,
      value: { title: 'Mashi speech corpus', targetLanguage: 'Shi', languageCode: 'shr', languageVariety: 'Mashi', annotationProfile: 'verbatim_transcription', status: 'active' },
    });
  });

  it('asks for the language name and code only when another language is chosen', () => {
    expect(buildProject({ ...mashi, language: 'other' })).toMatchObject({ ok: false, errors: { otherLanguage: expect.any(String), otherCode: expect.any(String) } });
    expect(buildProject({ ...mashi, language: 'other', otherLanguage: 'Kinande', otherCode: 'nnb' })).toMatchObject({ ok: true, value: { languageCode: 'nnb', targetLanguage: 'Kinande' } });
    expect(buildProject({ ...mashi, name: '  ' })).toMatchObject({ ok: false, errors: { name: expect.any(String) } });
  });

  it('will not create a source until the permission box is ticked', () => {
    expect(buildSource({ title: 'A film', link: '', permissionConfirmed: false })).toMatchObject({ ok: false, errors: { permissionConfirmed: expect.any(String) } });
  });

  it('keeps the link optional, https only, and picks the source type from it', () => {
    expect(buildSource({ title: 'A film', link: '', permissionConfirmed: true })).toMatchObject({ ok: true, value: { sourceType: 'creator_provided', originalUrl: null } });
    expect(buildSource({ title: 'A film', link: 'https://example.org/v', permissionConfirmed: true })).toMatchObject({ ok: true, value: { sourceType: 'external_url' } });
    expect(buildSource({ title: 'A film', link: 'http://example.org', permissionConfirmed: true })).toMatchObject({ ok: false, errors: { link: expect.any(String) } });
    expect(buildSource({ title: '', link: '', permissionConfirmed: true })).toMatchObject({ ok: false, errors: { title: expect.any(String) } });
  });

  it('stores the tick as the administrator\'s own dated statement, never allowing public sharing or model training', () => {
    const rights = buildPermission(new Date('2026-11-10T09:00:00Z'));
    expect(rights.decision).toBe('approved');
    expect(rights.permissionEvidence).toContain('2026-11-10');
    expect(rights.permissionEvidence).toContain(PERMISSION_TEXT);
    expect(rights.authorizedUses).toEqual({ internalProcessing: true, volunteerAccess: true, transcription: true, mlResearch: false, publicDistribution: false });
  });
});
