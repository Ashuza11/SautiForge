import { describe, expect, it } from 'vitest';

import { currencyOptions, paymentMethodOptions, preserveAnnotationValue, productOrServiceOptions, transactionIntentOptions } from './business-annotation-options';

describe('business annotation choices', () => {
  it('provides common pilot labels plus explicit uncertainty values', () => {
    expect(transactionIntentOptions.map(({ value }) => value)).toEqual(expect.arrayContaining(['record_sale', 'update_inventory', 'unknown', 'ambiguous', 'unavailable']));
    expect(currencyOptions.map(({ value }) => value)).toEqual(expect.arrayContaining(['CDF', 'USD', 'unknown']));
    expect(paymentMethodOptions.map(({ value }) => value)).toEqual(expect.arrayContaining(['cash', 'mobile_money', 'credit_debt']));
    expect(productOrServiceOptions.map(({ value }) => value)).toEqual(expect.arrayContaining([
      'airtime', 'phone_charger', 'sim_card', 'phone_battery', 'phone_screen', 'phone_case', 'wireless_earbuds',
    ]));
    expect(new Set(productOrServiceOptions.map(({ value }) => value)).size).toBe(productOrServiceOptions.length);
  });

  it('keeps an existing custom annotation value selectable', () => {
    expect(preserveAnnotationValue(currencyOptions, 'RWF')).toContainEqual({ label: 'RWF', value: 'RWF' });
    expect(preserveAnnotationValue(currencyOptions, null)).toBe(currencyOptions);
  });
});
