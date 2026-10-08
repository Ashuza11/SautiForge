import { describe, expect, it } from 'vitest';

import { buildRemotePrompt } from './remote-prompt';

describe('remote collection prompt', () => {
  it('shares only the guidance and a WhatsApp-bold fictional example', () => {
    const prompt = buildRemotePrompt([
      'Nipe montant ya deni zote ku anziya le 22 September',
      'Stock ya cartes Orange iko ngapi?',
    ]);
    expect(prompt).toBe([
      'Izi njo ma exemple za kuji-référer ako. Usiisome mot à mot; sema vile utaweza kuisema réellement. Na ujikaze usi enregistre kwenye kuko fujo ya mingi.',
      '1. *Nipe montant ya deni zote ku anziya le 22 September*',
      '2. *Stock ya cartes Orange iko ngapi?*',
    ].join('\n\n'));
    expect(prompt).not.toContain('Speaker code');
    expect(prompt).not.toContain('Submission code');
    expect(prompt).not.toContain('Scenario:');
    expect(prompt).not.toContain('Instructions:');
  });

  it('removes nested bold markers and normalizes whitespace', () => {
    expect(buildRemotePrompt(['  *Mfano*\nwa pili  '])).toContain('1. *Mfano wa pili*');
  });

  it('requires a fictional example', () => {
    expect(() => buildRemotePrompt(['   '])).toThrow(/Add at least one fictional example/);
  });
});
