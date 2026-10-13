import { describe, expect, it } from 'vitest';

import { currencyOptions, paymentMethodOptions, preserveAnnotationValue, transactionIntentOptions } from './business-annotation-options';

describe('business annotation choices', () => {
  it('provides common pilot labels plus explicit uncertainty values', () => {
    expect(transactionIntentOptions.map(({ value }) => value)).toEqual(expect.arrayContaining(['record_sale', 'update_inventory', 'unknown', 'ambiguous', 'unavailable']));
    expect(currencyOptions.map(({ value }) => value)).toEqual(expect.arrayContaining(['CDF', 'USD', 'unknown']));
    expect(paymentMethodOptions.map(({ value }) => value)).toEqual(expect.arrayContaining(['cash', 'mobile_money', 'credit_debt']));
  });

  it('keeps an existing custom annotation value selectable', () => {
    expect(preserveAnnotationValue(currencyOptions, 'RWF')).toContainEqual({ label: 'RWF', value: 'RWF' });
    expect(preserveAnnotationValue(currencyOptions, null)).toBe(currencyOptions);
  });
});
