export type AnnotationSelectOption = { label: string; value: string };

export const transactionIntentOptions: AnnotationSelectOption[] = [
  { label: 'Not annotated', value: '' },
  { label: 'Record a sale', value: 'record_sale' },
  { label: 'Record customer debt', value: 'record_customer_debt' },
  { label: 'Update inventory', value: 'update_inventory' },
  { label: 'Record debt repayment', value: 'record_debt_repayment' },
  { label: 'Query business information', value: 'query_business_information' },
  { label: 'Unknown', value: 'unknown' },
  { label: 'Ambiguous', value: 'ambiguous' },
  { label: 'Unavailable', value: 'unavailable' },
  { label: 'Other', value: 'other' },
];

export const currencyOptions: AnnotationSelectOption[] = [
  { label: 'Not annotated', value: '' },
  { label: 'Congolese franc (CDF)', value: 'CDF' },
  { label: 'US dollar (USD)', value: 'USD' },
  { label: 'Euro (EUR)', value: 'EUR' },
  { label: 'Unknown', value: 'unknown' },
  { label: 'Ambiguous', value: 'ambiguous' },
  { label: 'Unavailable', value: 'unavailable' },
  { label: 'Other', value: 'other' },
];

export const paymentMethodOptions: AnnotationSelectOption[] = [
  { label: 'Not annotated', value: '' },
  { label: 'Cash', value: 'cash' },
  { label: 'Mobile money', value: 'mobile_money' },
  { label: 'Bank transfer', value: 'bank_transfer' },
  { label: 'Credit or debt', value: 'credit_debt' },
  { label: 'Mixed payment', value: 'mixed' },
  { label: 'Unknown', value: 'unknown' },
  { label: 'Ambiguous', value: 'ambiguous' },
  { label: 'Unavailable', value: 'unavailable' },
  { label: 'Other', value: 'other' },
];

export function preserveAnnotationValue(options: AnnotationSelectOption[], value: string | null): AnnotationSelectOption[] {
  return value && !options.some((option) => option.value === value)
    ? [...options, { label: value, value }]
    : options;
}
