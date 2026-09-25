import { describe, expect, it } from 'vitest';

import { requireReadableByteCount } from './file-readability';

describe('audio file readability', () => {
  it('accepts a successful direct byte read', () => {
    expect(() => requireReadableByteCount(1)).not.toThrow();
  });

  it('rejects empty or invalid byte reads', () => {
    expect(() => requireReadableByteCount(0)).toThrow(/could not be read/);
    expect(() => requireReadableByteCount(Number.NaN)).toThrow(/could not be read/);
  });
});
