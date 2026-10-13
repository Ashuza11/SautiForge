import { describe, expect, it } from 'vitest';

import { codeSwitchingOptions, noiseLevelOptions, recordingEnvironmentOptions } from './recording-metadata-options';

describe('recording metadata choices', () => {
  it('provides the complete code-switching protocol vocabulary without duplicates', () => {
    const values = codeSwitchingOptions.map(({ value }) => value);
    expect(values).toEqual(['none', 'present', 'ambiguous', 'unknown']);
    expect(new Set(values).size).toBe(values.length);
  });

  it('provides selectable recording environments and noise levels', () => {
    expect(recordingEnvironmentOptions.map(({ value }) => value)).toContain('Indoor shop');
    expect(noiseLevelOptions.map(({ value }) => value)).toEqual(expect.arrayContaining(['quiet', 'moderate', 'high', 'unknown', 'ambiguous', 'unavailable']));
  });
});
