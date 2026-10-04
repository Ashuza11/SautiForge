import { describe, expect, it } from 'vitest';

import { parseScenarioExamples, scenarioDraftSchema } from './scenario';

describe('scenarioDraftSchema', () => {
  it('accepts optional structured reference data without making it project-specific', () => {
    const result = scenarioDraftSchema.parse({
      title: 'Describe a service request',
      description: '',
      collectionInstructions: 'Use a fictional example.',
      expectedIntent: 'request_service',
      collectionMethod: 'role_play',
      version: '1.0',
      remoteExamples: ['Mfano wa kwanza'],
      referenceData: { urgency: 'routine' },
      status: 'active',
    });
    expect(result.referenceData).toEqual({ urgency: 'routine' });
  });

  it('parses one remote collection example per non-empty line', () => {
    expect(parseScenarioExamples('Mfano wa kwanza\n\n Mfano wa pili ')).toEqual(['Mfano wa kwanza', 'Mfano wa pili']);
  });

  it('limits a scenario to 25 unique remote collection examples', () => {
    expect(() => parseScenarioExamples(Array.from({ length: 26 }, (_, index) => `Example ${index}`).join('\n'))).toThrow();
    expect(() => parseScenarioExamples('Repeated\nRepeated')).toThrow(/unique/);
  });
});
