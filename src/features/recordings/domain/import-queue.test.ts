import { describe, expect, it } from 'vitest';

import type { AcceptedTake } from './recording';
import { advanceImportedTakeQueue } from './import-queue';

const first = { sourceUri: 'file:///first.opus' } as AcceptedTake;
const second = { sourceUri: 'file:///second.opus' } as AcceptedTake;

describe('batch import review queue', () => {
  it('advances in picker order without mutating the remaining queue', () => {
    const queue = [first, second];
    const result = advanceImportedTakeQueue(queue);
    expect(result).toEqual({ next: first, remaining: [second] });
    expect(queue).toEqual([first, second]);
  });

  it('returns an explicit empty state after the final imported file', () => {
    expect(advanceImportedTakeQueue([])).toEqual({ next: null, remaining: [] });
  });
});
