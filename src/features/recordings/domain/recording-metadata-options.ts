export const codeSwitchingOptions = [
  { label: 'None', value: 'none' },
  { label: 'Present', value: 'present' },
  { label: 'Ambiguous', value: 'ambiguous' },
  { label: 'Unknown', value: 'unknown' },
] as const;

export const CUSTOM_METADATA_VALUE = '__custom__';

export const recordingEnvironmentOptions = [
  { label: 'Indoor shop', value: 'Indoor shop' },
  { label: 'Outdoor market', value: 'Outdoor market' },
  { label: 'Quiet room', value: 'Quiet room' },
  { label: 'Street or roadside', value: 'Street or roadside' },
  { label: 'Remote imported audio', value: 'Remote imported audio' },
  { label: 'Other / enter a value', value: CUSTOM_METADATA_VALUE },
] as const;

export const noiseLevelOptions = [
  { label: 'Quiet', value: 'quiet' },
  { label: 'Low noise', value: 'low' },
  { label: 'Moderate noise', value: 'moderate' },
  { label: 'High noise', value: 'high' },
  { label: 'Very high noise', value: 'very_high' },
  { label: 'Unknown', value: 'unknown' },
  { label: 'Ambiguous', value: 'ambiguous' },
  { label: 'Unavailable', value: 'unavailable' },
] as const;
