import { describe, expect, it } from 'vitest';

import { batchProgress, clipState, differencesMessage, firstDifference, percent, stateLabel, summarize, versions, type BatchResult, type ClipResult } from './results-view';

const t = (who: string, text: string) => ({ id: who + text, contributorId: who, pseudonym: who, text, createdAt: '2026-11-10T10:00:00.000Z' });
const clip = (key: string, texts: [string, string][], status = 'published'): ClipResult => ({
  clipId: key, clipKey: key, durationMs: 3000, position: 1, status, transcripts: texts.map(([who, text]) => t(who, text)), skips: 0,
});
const batch = (clips: ClipResult[]): BatchResult => ({ batch: { id: 'b', title: 'Batch 1', status: 'open', createdAt: '2026-11-10T10:00:00.000Z' }, clips, volunteers: 2 });

describe('results helpers', () => {
  it('names the state of each clip', () => {
    expect(clipState(clip('a', []), 2)).toBe('waiting');
    expect(clipState(clip('a', [['N', 'x']]), 2)).toBe('partial');
    expect(clipState(clip('a', [['N', 'x'], ['B', 'x']]), 2)).toBe('agree');
    expect(clipState(clip('a', [['N', 'x'], ['B', 'y']]), 2)).toBe('differ');
    expect(clipState(clip('a', [['N', 'x'], ['B', 'x'], ['C', 'y']]), 2)).toBe('differ');
    expect(stateLabel(clip('a', [['N', 'x']]), 2)).toBe('1 of 2');
    expect(stateLabel(clip('a', []), 2)).toBe('Waiting');
  });

  it('measures a batch without counting answers beyond what is needed', () => {
    const item = batch([
      clip('a', [['N', 'x'], ['B', 'x'], ['C', 'x']]),
      clip('b', [['N', 'x'], ['B', 'y']]),
      clip('c', [['N', 'x']]),
      clip('d', []),
    ]);
    expect(batchProgress(item, 2)).toMatchObject({ clips: 4, complete: 2, agree: 1, differ: 1, answers: 5, needed: 8 });
    expect(percent(5, 8)).toBe(63);
    expect(percent(0, 0)).toBe(0);
  });

  it('summarizes across batches', () => {
    expect(summarize({ required: 2, volunteers: 3, batches: [batch([clip('a', [['N', 'x'], ['B', 'y']]), clip('b', [['N', 'z']])])] })).toEqual({ volunteers: 3, answers: 3, complete: 1, needLook: 1 });
  });

  it('finds the first difference to show', () => {
    expect(firstDifference(clip('a', [['N', 'x'], ['B', 'x']]))).toBeNull();
    const found = firstDifference(clip('a', [['N', 'mwana'], ['B', 'mwana wa']]));
    expect(found?.first.pseudonym).toBe('N');
    expect(found?.other.pseudonym).toBe('B');
    expect(found?.diff.differing).toBe(3);
  });

  it('labels distinct versions A, B, C and leaves nicknames out of the shared message', () => {
    expect(versions(clip('a', [['N', 'x'], ['B', 'y'], ['C', 'x']]))).toEqual([{ label: 'A', text: 'x' }, { label: 'B', text: 'y' }]);
    const message = differencesMessage([clip('c001', [['Neema', 'mwana'], ['Baraka', 'mwana wa']]), clip('c002', [['Neema', 'ok'], ['Baraka', 'ok']])], 2);
    expect(message).toContain('Clip c001');
    expect(message).toContain('A) mwana\nB) mwana wa');
    expect(message).not.toContain('c002');
    expect(message).not.toMatch(/Neema|Baraka/);
    expect(differencesMessage([clip('a', [['N', 'x'], ['B', 'x']])], 2)).toBeNull();
    expect(differencesMessage([clip('a', [['N', 'x'], ['B', 'y']]), clip('b', [['N', 'p'], ['B', 'q']])], 2)).toContain('2 clips');
  });
});
