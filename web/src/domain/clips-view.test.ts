import { describe, expect, it } from 'vitest';

import type { ApiClip } from '../api/client';
import { filterClips, formatClock, formatSeconds, formatTotal, speakerLabel, summarizeClips } from './clips-view';

const make = (key: string, status: ApiClip['clip']['status'], durationMs: number, variants: ('original' | 'vocals_htdemucs')[] = ['original', 'vocals_htdemucs']): ApiClip => ({
  clip: { id: key, clipKey: key, startMs: 0, endMs: durationMs, durationMs, speakerRole: 'narrator', speakerName: null, hasMusic: false, tier: 'asr_tts', status },
  files: variants.map((variant) => ({ variant, status: 'verified', sizeBytes: 1 })),
});

describe('clips view helpers', () => {
  it('formats film positions and durations', () => {
    expect(formatClock(318_600)).toBe('5:18.6');
    expect(formatClock(3_082)).toBe('0:03.1');
    expect(formatClock(59_960)).toBe('1:00.0');
    expect(formatSeconds(1_516)).toBe('1.5 s');
    expect(formatTotal(207_000)).toBe('3 min 27 s');
    expect(formatTotal(42_000)).toBe('42 s');
  });

  it('labels speakers with role and name', () => {
    const base = make('a', 'published', 1000).clip;
    expect(speakerLabel(base)).toBe('Narrator');
    expect(speakerLabel({ ...base, speakerRole: 'character', speakerName: 'Jesus' })).toBe('Character · Jesus');
    expect(speakerLabel({ ...base, speakerRole: 'multiple' })).toBe('Several voices');
  });

  it('filters by status and summarizes only published clips for hours', () => {
    const clips = [make('a', 'published', 3000), make('b', 'published', 2000, ['vocals_htdemucs']), make('c', 'withdrawn', 9000), make('d', 'draft', 1000)];
    expect(filterClips(clips, 'all')).toHaveLength(4);
    expect(filterClips(clips, 'withdrawn').map((c) => c.clip.clipKey)).toEqual(['c']);
    expect(summarizeClips(clips)).toEqual({ total: 4, published: 2, draft: 1, withdrawn: 1, publishedMs: 5000, withOriginal: 1 });
  });
});
