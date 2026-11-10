import { describe, expect, it } from 'vitest';

import type { ApiBatch, ApiClip } from '../api/client';
import { availableClips, batchLink, defaultSelection, newestFirst, shareMessage } from './batches-view';

const clip = (id: string, status: ApiClip['clip']['status'] = 'published'): ApiClip => ({
  clip: { id, clipKey: id, startMs: 0, endMs: 1000, durationMs: 1000, speakerRole: 'unknown', speakerName: null, hasMusic: false, tier: 'asr', status },
  files: [],
});
const batch = (id: string, status: 'open' | 'closed', clipIds: string[], createdAt = '2026-11-10T10:00:00.000Z'): ApiBatch => ({
  batch: { id, title: id, status, createdAt, closedAt: status === 'closed' ? createdAt : null }, clipIds, token: 'tok',
});

describe('batch helpers', () => {
  it('offers only published clips that are not in an open batch', () => {
    const clips = [clip('a'), clip('b'), clip('c'), clip('d', 'withdrawn'), clip('e', 'draft')];
    const free = availableClips(clips, [batch('1', 'open', ['a']), batch('2', 'closed', ['b'])]);
    expect(free.map((item) => item.clip.id)).toEqual(['b', 'c']);
  });

  it('pre-selects the first five', () => {
    const clips = Array.from({ length: 8 }, (_, i) => clip(`c${i}`));
    expect(defaultSelection(clips)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
    expect(defaultSelection(clips.slice(0, 2))).toEqual(['c0', 'c1']);
  });

  it('builds a link that carries the batch id and its code', () => {
    expect(batchLink('https://site.vercel.app/', batch('abc', 'open', []))).toBe('https://site.vercel.app/#/b/abc.tok');
  });

  it('writes a short French message with the link and the number of clips', () => {
    const text = shareMessage({ language: 'Mashi', count: 5, link: 'https://x/#/b/1.t' });
    expect(text).toContain('Mashi');
    expect(text).toContain('5 courts extraits');
    expect(text).toContain('https://x/#/b/1.t');
    expect(shareMessage({ language: 'Mashi', count: 1, link: 'l' })).toContain('1 court extrait ');
  });

  it('lists the newest batch first', () => {
    expect(newestFirst([batch('old', 'open', [], '2026-11-01T00:00:00.000Z'), batch('new', 'open', [], '2026-11-09T00:00:00.000Z')]).map((item) => item.batch.id)).toEqual(['new', 'old']);
  });
});
