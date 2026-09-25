import { describe, expect, it } from 'vitest';

import {
  ageBracketOptions,
  businessCategoryOptions,
  genderOptions,
  isCustomParticipantValue,
  OTHER_PARTICIPANT_VALUE,
  primaryLanguageOptions,
} from './participant-form-options';

describe('participant form choices', () => {
  it('offers common pilot languages and an explicit free-text path', () => {
    expect(primaryLanguageOptions.map(({ value }) => value)).toEqual(expect.arrayContaining(['Kingwana', 'Swahili', 'French', OTHER_PARTICIPANT_VALUE]));
  });

  it('keeps optional selectors nullable and business categories extensible', () => {
    expect(ageBracketOptions[0]?.value).toBe('');
    expect(genderOptions[0]?.value).toBe('');
    expect(businessCategoryOptions.map(({ value }) => value)).toEqual(expect.arrayContaining(['', 'Telecom and mobile money', OTHER_PARTICIPANT_VALUE]));
  });

  it('preserves previously entered values that are not in a current option list', () => {
    expect(isCustomParticipantValue('Agricultural cooperative', businessCategoryOptions)).toBe(true);
    expect(isCustomParticipantValue('Retail shop', businessCategoryOptions)).toBe(false);
    expect(isCustomParticipantValue('', businessCategoryOptions)).toBe(false);
  });
});
