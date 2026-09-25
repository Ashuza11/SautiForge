import { describe, expect, it, vi } from 'vitest';

import { appStateInterruptsRecording, stopAndDiscardInterruptedTake } from './interruption';

describe('recording interruption cleanup', () => {
  it('stops and discards an interrupted temporary take', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const discard = vi.fn();

    await expect(stopAndDiscardInterruptedTake({ stop, getUri: () => 'file:///cache/take.m4a', discard }))
      .resolves.toEqual({ discarded: true, errors: [] });
    expect(stop).toHaveBeenCalledOnce();
    expect(discard).toHaveBeenCalledWith('file:///cache/take.m4a');
  });

  it('still discards recorder output when stopping reports an interruption error', async () => {
    const discard = vi.fn();
    const result = await stopAndDiscardInterruptedTake({
      stop: vi.fn().mockRejectedValue(new Error('audio focus lost')),
      getUri: () => 'file:///cache/interrupted.m4a',
      discard,
    });

    expect(result).toEqual({ discarded: true, errors: ['recorder stop: audio focus lost'] });
    expect(discard).toHaveBeenCalledOnce();
  });

  it('reports missing output and recognizes every non-active app state', async () => {
    await expect(stopAndDiscardInterruptedTake({ stop: async () => undefined, getUri: () => null, discard: vi.fn() }))
      .resolves.toEqual({ discarded: false, errors: ['recorder returned no temporary file'] });
    expect(appStateInterruptsRecording('active')).toBe(false);
    expect(appStateInterruptsRecording('inactive')).toBe(true);
    expect(appStateInterruptsRecording('background')).toBe(true);
  });

  it('reports a temporary file that could not be removed', async () => {
    await expect(stopAndDiscardInterruptedTake({
      stop: async () => undefined,
      getUri: () => 'file:///cache/locked.m4a',
      discard: () => { throw new Error('file busy'); },
    })).resolves.toEqual({ discarded: false, errors: ['temporary file cleanup: file busy'] });
  });
});
