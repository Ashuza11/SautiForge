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

export const productOrServiceOptions: AnnotationSelectOption[] = [
  { label: 'Airtime / unités', value: 'airtime' },
  { label: 'Mobile data / forfait internet', value: 'mobile_data' },
  { label: 'Mobile phone', value: 'mobile_phone' },
  { label: 'Phone charger / chargeur', value: 'phone_charger' },
  { label: 'SIM card / carte SIM', value: 'sim_card' },
  { label: 'Phone battery / batterie', value: 'phone_battery' },
  { label: 'Phone screen / écran', value: 'phone_screen' },
  { label: 'Phone case / coque', value: 'phone_case' },
  { label: 'Wireless earbuds / AirPods', value: 'wireless_earbuds' },
  { label: 'Memory card', value: 'memory_card' },
  { label: 'Phone repair', value: 'phone_repair' },
  { label: 'Unknown', value: 'unknown' },
  { label: 'Ambiguous', value: 'ambiguous' },
  { label: 'Unavailable', value: 'unavailable' },
];

export function preserveAnnotationValue(options: AnnotationSelectOption[], value: string | null): AnnotationSelectOption[] {
  return value && !options.some((option) => option.value === value)
    ? [...options, { label: value, value }]
    : options;
}
