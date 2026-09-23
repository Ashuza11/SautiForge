import { describe, expect, it } from 'vitest';

import { businessAnnotationPayloadSchema } from './annotation';

describe('business annotation validation', () => {
  it('allows explicit unknown values without requiring irrelevant fields', () => {
    expect(businessAnnotationPayloadSchema.parse({
      transactionIntent: 'record_sale', productOrService: 'airtime', quantity: 'unknown', amount: 'ambiguous',
      currency: 'CDF', amountPaid: null, outstandingDebt: null, paymentMethod: 'unavailable', transactionReference: null,
    }).quantity).toBe('unknown');
  });

  it('rejects fields outside the versioned schema', () => {
    expect(() => businessAnnotationPayloadSchema.parse({
      transactionIntent: null, productOrService: null, quantity: null, amount: null, currency: null,
      amountPaid: null, outstandingDebt: null, paymentMethod: null, transactionReference: null, customerName: 'private',
    })).toThrow();
  });
});
