import { describe, expect, it } from 'vitest';

import { acceptClip, acceptanceProblems, adjustClip, editReview, mergeWithNext, newReview, nextClipId, parseManifest, rejectClip, reopenClip, reviewProgress, serializeManifest, splitClip, validateManifest, type SegmentationManifest } from './segmentation';

const NOW = new Date('2026-11-04T10:00:00Z');

function clip(id: string, startMs: number, endMs: number, extra: Record<string, unknown> = {}) {
  return { id, startMs, endMs, durationMs: endMs - startMs, speechStartMs: startMs + 100, speechEndMs: endMs - 100, spanCount: 2, cutCandidatesMs: [] as number[], flags: [] as string[], metrics: { rmsDb: -20 }, review: newReview(), ...extra };
}

function fixture(): SegmentationManifest {
  return parseManifest(JSON.stringify({
    schema: 'sautiforge.segmentation/1', createdAt: '2026-11-03T10:00:00Z',
    source: { fileName: 'film.mp4', sha256: 'a'.repeat(64), durationMs: 60_000, workingAudio: 'audio_16k.wav', workingSampleRate: 16_000, sourceUrl: 'https://example.org' },
    processing: { clips: { min_clip_ms: 1500, target_max_ms: 12000, hard_max_ms: 20000 } }, speechSpans: [],
    clips: [clip('c001', 1_000, 9_000, { cutCandidatesMs: [4_000, 6_000] }), clip('c002', 12_000, 18_000), clip('c003', 30_000, 33_000)],
  }));
}

describe('segmentation manifest', () => {
  it('round-trips unknown source fields and validates', () => {
    const manifest = fixture();
    expect(manifest.source.sourceUrl).toBe('https://example.org');
    expect(parseManifest(serializeManifest(manifest))).toEqual(manifest);
  });

  it('rejects wrong schema, bad hash and overlapping clips', () => {
    expect(() => parseManifest('nope')).toThrow(/not valid JSON/);
    expect(() => parseManifest(JSON.stringify({ schema: 'other/1' }))).toThrow(/not a SautiForge segmentation manifest/);
    const manifest = fixture();
    manifest.clips[1] = { ...manifest.clips[1]!, startMs: 8_000, durationMs: 10_000 };
    expect(() => validateManifest(manifest)).toThrow(/overlaps/);
  });
});

describe('boundary editing', () => {
  it('moves edges, recomputes flags and drops an acceptance', () => {
    let manifest = editReview(fixture(), 'c002', { transcript: 'text', tier: 'asr' });
    manifest = acceptClip(manifest, 'c002', 'Amani', NOW);
    const moved = adjustClip(manifest, 'c002', 11_500, 18_000);
    const result = moved.clips[1]!;
    expect(result.durationMs).toBe(6_500);
    expect(result.review.status).toBe('proposed');
    expect(result.review.transcript).toBe('text');
    expect(result.flags).toContain('tts_length_ok');
    const long = adjustClip(fixture(), 'c001', 1_000, 11_900);
    expect(long.clips[0]!.flags).toContain('tts_length_ok');
    expect(adjustClip(fixture(), 'c003', 30_000, 44_000).clips[2]!.flags).toEqual(['over_target']);
    expect(adjustClip(fixture(), 'c003', 30_000, 51_000).clips[2]!.flags).toEqual(['needs_manual_split']);
  });

  it('refuses overlaps, tiny clips and out-of-range edges', () => {
    const manifest = fixture();
    expect(() => adjustClip(manifest, 'c002', 8_000, 18_000)).toThrow(/previous clip/);
    expect(() => adjustClip(manifest, 'c002', 12_000, 31_000)).toThrow(/next clip/);
    expect(() => adjustClip(manifest, 'c002', 12_000, 12_200)).toThrow(/at least/);
    expect(() => adjustClip(manifest, 'c003', 30_000, 61_000)).toThrow(/inside the source/);
    expect(() => adjustClip(manifest, 'c003', 30_000.5, 33_000)).toThrow(/whole milliseconds/);
  });
});

describe('split and merge', () => {
  it('splits at a pause into two review-reset clips with a fresh id', () => {
    const split = splitClip(fixture(), 'c001', 5_000);
    expect(split.clips.map((item) => item.id)).toEqual(['c001', 'c004', 'c002', 'c003']);
    const [left, right] = split.clips;
    expect([left!.endMs, right!.startMs, right!.endMs]).toEqual([5_000, 5_000, 9_000]);
    expect(left!.cutCandidatesMs).toEqual([4_000]);
    expect(right!.cutCandidatesMs).toEqual([6_000]);
    expect(left!.review.status).toBe('proposed');
    expect(nextClipId(split)).toBe('c005');
  });

  it('flags a long silence created by merging and clears it when splitting', () => {
    const merged = mergeWithNext(fixture(), 'c002'); // 18_000 -> 30_000 gap of 12 s
    expect(merged.clips[1]!.flags).toContain('long_internal_pause');
    const split = splitClip(merged, 'c002', 24_000);
    expect(split.clips.flatMap((clip) => clip.flags)).not.toContain('long_internal_pause');
  });

  it('accepts a manifest that names a separated vocals file', () => {
    const raw = JSON.parse(serializeManifest(fixture()));
    raw.source.vocalsAudio = 'vocals_16k.wav';
    expect(parseManifest(JSON.stringify(raw)).source.vocalsAudio).toBe('vocals_16k.wav');
  });

  it('refuses a split too close to an edge', () => {
    expect(() => splitClip(fixture(), 'c001', 1_200)).toThrow(/away from both edges/);
  });

  it('merges with the next clip and keeps the pause as a cut candidate', () => {
    const merged = mergeWithNext(fixture(), 'c001');
    expect(merged.clips).toHaveLength(2);
    expect([merged.clips[0]!.startMs, merged.clips[0]!.endMs]).toEqual([1_000, 18_000]);
    expect(merged.clips[0]!.cutCandidatesMs).toContain(10_500);
    expect(merged.clips[0]!.spanCount).toBe(4);
    expect(merged.clips[0]!.flags).toContain('over_target');
    expect(() => mergeWithNext(merged, 'c003')).toThrow(/following clip/);
  });
});

describe('review decisions', () => {
  it('requires transcript, tier and confirmed no-music for TTS before accepting', () => {
    expect(acceptanceProblems(newReview())).toHaveLength(2);
    expect(() => acceptClip(fixture(), 'c001', 'Amani', NOW)).toThrow(/spoken/);
    let manifest = editReview(fixture(), 'c001', { transcript: '  mbote  ', tier: 'asr_tts', hasMusic: null });
    expect(() => acceptClip(manifest, 'c001', 'Amani', NOW)).toThrow(/free of music/);
    manifest = editReview(manifest, 'c001', { hasMusic: false });
    manifest = acceptClip(manifest, 'c001', 'Amani', NOW);
    expect(manifest.clips[0]!.review).toMatchObject({ status: 'accepted', transcript: 'mbote', reviewedBy: 'Amani', reviewedAt: NOW.toISOString() });
  });

  it('demotes an accepted clip when an edit makes it invalid', () => {
    let manifest = editReview(fixture(), 'c001', { transcript: 'x', tier: 'asr' });
    manifest = acceptClip(manifest, 'c001', 'A', NOW);
    manifest = editReview(manifest, 'c001', { transcript: '   ' });
    expect(manifest.clips[0]!.review.status).toBe('proposed');
  });

  it('rejects with a reason and can be reopened', () => {
    expect(() => rejectClip(fixture(), 'c002', '  ', 'A', NOW)).toThrow(/reason/);
    let manifest = rejectClip(fixture(), 'c002', 'music only', 'A', NOW);
    expect(manifest.clips[1]!.review.status).toBe('rejected');
    manifest = reopenClip(manifest, 'c002');
    expect(manifest.clips[1]!.review).toMatchObject({ status: 'proposed', rejectReason: null });
  });

  it('summarises progress', () => {
    let manifest = editReview(fixture(), 'c001', { transcript: 'x', tier: 'asr_tts', hasMusic: false });
    manifest = acceptClip(manifest, 'c001', 'A', NOW);
    manifest = rejectClip(manifest, 'c003', 'not speech', 'A', NOW);
    expect(reviewProgress(manifest)).toEqual({ total: 3, accepted: 1, rejected: 1, proposed: 1, tts: 1, acceptedSeconds: 8 });
  });
});
