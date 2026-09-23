import { describe, expect, it } from 'vitest';

import { scenarioDraftSchema } from './scenario';

describe('scenarioDraftSchema', () => {
  it('accepts optional structured reference data without making it project-specific', () => {
    const result = scenarioDraftSchema.parse({
      title: 'Describe a service request',
      description: '',
      collectionInstructions: 'Use a fictional example.',
      expectedIntent: 'request_service',
      collectionMethod: 'role_play',
      version: '1.0',
      referenceData: { urgency: 'routine' },
      status: 'active',
    });
    expect(result.referenceData).toEqual({ urgency: 'routine' });
  });
});
