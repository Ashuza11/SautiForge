import { describe, expect, it } from 'vitest';

import { buildRemotePrompt } from './remote-prompt';

describe('remote collection prompt', () => {
  it('contains pseudonymous linkage, task context, and safety instructions', () => {
    const prompt = buildRemotePrompt({
      speakerCode: 'SPK-DE0A967692CC',
      submissionId: 'SUB-1234ABCD',
      scenarioTitle: 'Recording a sale',
      instructions: 'Describe a fictional sale.',
      fictionalExample: 'Two bottles of water for 2,000 CDF.',
    });
    expect(prompt).toContain('SPK-DE0A967692CC');
    expect(prompt).toContain('SUB-1234ABCD');
    expect(prompt).toContain('Two bottles of water');
    expect(prompt).toContain('Do not share real customer names');
  });
});
