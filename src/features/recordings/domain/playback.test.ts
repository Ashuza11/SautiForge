import { describe, expect, it } from 'vitest';

import { shouldRestartFinishedPlayback } from './playback';

describe('recording playback', () => {
  it('restarts a take after playback reaches the end', () => {
    expect(shouldRestartFinishedPlayback(true)).toBe(true);
  });

  it('continues from the current position when playback has not finished', () => {
    expect(shouldRestartFinishedPlayback(false)).toBe(false);
  });
});
