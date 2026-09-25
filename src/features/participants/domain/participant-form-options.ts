export type ParticipantSelectOption = { label: string; value: string };

export const OTHER_PARTICIPANT_VALUE = '__other__';

export const primaryLanguageOptions: ParticipantSelectOption[] = [
  { label: 'Kingwana', value: 'Kingwana' },
  { label: 'Swahili', value: 'Swahili' },
  { label: 'French', value: 'French' },
  { label: 'Lingala', value: 'Lingala' },
  { label: 'Mashi', value: 'Mashi' },
  { label: 'Kinyarwanda', value: 'Kinyarwanda' },
  { label: 'English', value: 'English' },
  { label: 'Other / enter a language', value: OTHER_PARTICIPANT_VALUE },
];

export const ageBracketOptions: ParticipantSelectOption[] = [
  { label: 'Prefer not to say / unavailable', value: '' },
  ...['18–24', '25–34', '35–44', '45–54', '55–64', '65+'].map((value) => ({ label: value, value })),
];

export const genderOptions: ParticipantSelectOption[] = [
  { label: 'Prefer not to say / unavailable', value: '' },
  { label: 'Woman', value: 'Woman' },
  { label: 'Man', value: 'Man' },
  { label: 'Non-binary', value: 'Non-binary' },
  { label: 'Self-describe', value: OTHER_PARTICIPANT_VALUE },
];

export const businessCategoryOptions: ParticipantSelectOption[] = [
  { label: 'Unavailable', value: '' },
  { label: 'Telecom and mobile money', value: 'Telecom and mobile money' },
  { label: 'Retail shop', value: 'Retail shop' },
  { label: 'Wholesale', value: 'Wholesale' },
  { label: 'Food and hospitality', value: 'Food and hospitality' },
  { label: 'Transport', value: 'Transport' },
  { label: 'Personal services', value: 'Personal services' },
  { label: 'Professional services', value: 'Professional services' },
  { label: 'Other / enter a category', value: OTHER_PARTICIPANT_VALUE },
];

export function isCustomParticipantValue(value: string, options: ParticipantSelectOption[]): boolean {
  return Boolean(value) && !options.some((option) => option.value === value);
}
