import { describe, expect, it } from 'vitest';

import { codeSwitchingOptions } from './recording-metadata-options';

describe('recording metadata choices', () => {
  it('provides the complete code-switching protocol vocabulary without duplicates', () => {
    const values = codeSwitchingOptions.map(({ value }) => value);
    expect(values).toEqual(['none', 'present', 'ambiguous', 'unknown']);
    expect(new Set(values).size).toBe(values.length);
  });
});
