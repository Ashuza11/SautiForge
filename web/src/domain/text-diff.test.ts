import { describe, expect, it } from 'vitest';

import { diffText } from './text-diff';

const marked = (parts: { kind: string; text: string }[]) => parts.map((part) => (part.kind === 'changed' ? `[${part.text}]` : part.text)).join('');

describe('diffText', () => {
  it('reports identical texts as the same', () => {
    const diff = diffText('mwana wa Mashi', 'mwana wa Mashi');
    expect(diff).toMatchObject({ same: true, differing: 0, similarity: 100 });
    expect(marked(diff.left)).toBe('mwana wa Mashi');
  });

  it('marks only the characters that differ, in both texts', () => {
    const diff = diffText('mwana wa', 'mwana wa Mashi');
    expect(marked(diff.left)).toBe('mwana wa');
    expect(marked(diff.right)).toBe('mwana wa[ Mashi]');
    expect(diff.differing).toBe(6);
    const swap = diffText('kabili', 'kabiri');
    expect(marked(swap.left)).toBe('kabi[l]i');
    expect(marked(swap.right)).toBe('kabi[r]i');
    expect(swap).toMatchObject({ same: false, differing: 2, similarity: 83 });
  });

  it('keeps accented and special letters whole', () => {
    const diff = diffText('mwâna', 'mwana');
    expect(marked(diff.left)).toBe('mw[â]na');
    expect(marked(diff.right)).toBe('mw[a]na');
    expect(diffText('😀a', '😀b').left.map((part) => part.text)).toEqual(['😀', 'a']);
  });

  it('handles empty and completely different texts', () => {
    expect(diffText('', '')).toMatchObject({ same: true, similarity: 100 });
    expect(diffText('abc', '')).toMatchObject({ same: false, differing: 3, similarity: 0 });
    expect(diffText('abc', 'xyz').similarity).toBe(0);
  });

  it('is fast enough for the longest allowed transcript', () => {
    const long = 'ab'.repeat(500);
    const start = performance.now();
    diffText(long, long.replace(/a/g, 'c'));
    expect(performance.now() - start).toBeLessThan(500);
  });
});
