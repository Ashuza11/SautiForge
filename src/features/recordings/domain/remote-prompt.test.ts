import { describe, expect, it } from 'vitest';

import { buildRemotePrompt } from './remote-prompt';

describe('remote collection prompt', () => {
  it('shares only the guidance and a WhatsApp-bold fictional example', () => {
    const prompt = buildRemotePrompt('Nipe montant ya deni zote ku anziya le 22 September');
    expect(prompt).toBe([
      'Iyi njo exemple ya kuji-référer ako. Usiisome mot à mot; sema vile utaweza kuisema réellement.',
      '*Nipe montant ya deni zote ku anziya le 22 September*',
    ].join('\n\n'));
    expect(prompt).not.toContain('Speaker code');
    expect(prompt).not.toContain('Submission code');
    expect(prompt).not.toContain('Scenario:');
    expect(prompt).not.toContain('Instructions:');
  });

  it('removes nested bold markers and normalizes whitespace', () => {
    expect(buildRemotePrompt('  *Mfano*\nwa pili  ')).toContain('*Mfano wa pili*');
  });

  it('requires a fictional example', () => {
    expect(() => buildRemotePrompt('   ')).toThrow(/Enter a fictional example/);
  });
});
