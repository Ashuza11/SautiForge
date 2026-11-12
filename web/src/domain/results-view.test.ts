import { describe, expect, it } from 'vitest';

import { approvedCount, batchProgress, clipBadge, clipDifferenceBlock, clipDifferencesMessage, clipState, differencesMessage, firstDifference, needsDecision, percent, stateLabel, summarize, versions, type BatchResult, type ClipResult } from './results-view';

const t = (who: string, text: string) => ({ id: who + text, contributorId: who, pseudonym: who, text, correction: null, createdAt: '2026-11-10T10:00:00.000Z' });
const clip = (key: string, texts: [string, string][], status = 'published'): ClipResult => ({
  clipId: key, clipKey: key, durationMs: 3000, position: 1, status, transcripts: texts.map(([who, text]) => t(who, text)), skips: 0, final: null,
});
const batch = (clips: ClipResult[]): BatchResult => ({ batch: { id: 'b', title: 'Batch 1', status: 'open', createdAt: '2026-11-10T10:00:00.000Z' }, token: 'code', clips, volunteers: 2 });

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
    expect(summarize({ required: 2, volunteers: 3, batches: [batch([clip('a', [['N', 'x'], ['B', 'y']]), clip('b', [['N', 'z']])])] })).toEqual({ approved: 0, volunteers: 3, answers: 3, complete: 1, needLook: 1 });
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
    expect(message).toContain('Extrait c001');
    expect(message).toContain('A) mwana\nB) mwana *wa*');
    expect(message).not.toContain('c002');
    expect(message).not.toMatch(/Neema|Baraka/);
    expect(differencesMessage([clip('a', [['N', 'x'], ['B', 'x']])], 2)).toBeNull();
    expect(differencesMessage([clip('a', [['N', 'x'], ['B', 'y']]), clip('b', [['N', 'p'], ['B', 'q']])], 2)).toContain('2 extraits');
  });

  it('puts the words that differ in bold for WhatsApp, in French', () => {
    const block = clipDifferenceBlock(clip('c005', [['N', 'bantu ba mashi'], ['B', 'bantu ba mashe']]));
    expect(block).toBe('Extrait c005\nA) bantu ba *mashi*\nB) bantu ba *mashe*');
    const link = (id: string) => `https://site/#/c/${id}`;
    expect(clipDifferenceBlock(clip('c005', [['N', 'x'], ['B', 'y']]), link)).toContain('🔊 Écouter : https://site/#/c/c005');
    expect(differencesMessage([clip('c005', [['N', 'x'], ['B', 'y']])], 2, link)).toContain('🔊 Écouter');
    const message = clipDifferencesMessage(clip('c005', [['N', 'a b'], ['B', 'a c']]));
    expect(message).toContain('Quels mots sont justes ?');
    expect(message).toContain('en *gras*');
    expect(message).toContain('Répondez avec la lettre');
  });

  it('shows the final decision before the volunteer state', () => {
    const approved = { ...clip('a', [['N', 'x'], ['B', 'y']]), final: { version: 2, decision: 'approved' as const, text: 'x', note: '', createdAt: '' } };
    const excluded = { ...clip('b', []), final: { version: 1, decision: 'excluded' as const, text: null, note: 'noise', createdAt: '' } };
    expect(clipBadge(approved, 2)).toEqual({ label: 'Approved', kind: 'approved' });
    expect(clipBadge(excluded, 2)).toEqual({ label: 'Excluded', kind: 'excluded' });
    expect(clipBadge(clip('c', [['N', 'x'], ['B', 'y']]), 2)).toEqual({ label: 'Differ', kind: 'differ' });
    expect(approvedCount(batch([approved, excluded, clip('d', [])]))).toBe(1);
    expect(summarize({ required: 2, volunteers: 1, batches: [batch([approved, excluded])] }).approved).toBe(1);
  });

  it('stops asking about a clip once the admin has decided it', () => {
    const differing = clip('a', [['N', 'x'], ['B', 'y']]);
    const decided = { ...clip('z', [['N', 'p'], ['B', 'q']]), final: { version: 1, decision: 'approved' as const, text: 'x', note: '', createdAt: '' } };
    expect(needsDecision(differing, 2)).toBe(true);
    expect(needsDecision(decided, 2)).toBe(false);
    expect(batchProgress(batch([differing, decided]), 2).differ).toBe(1);
    expect(summarize({ required: 2, volunteers: 2, batches: [batch([differing, decided])] }).needLook).toBe(1);
    expect(differencesMessage([decided], 2)).toBeNull();
    const message = differencesMessage([differing, decided], 2) ?? '';
    expect(message).toContain('Extrait a');
    expect(message).not.toContain('Extrait z');
  });
});
