import { describe, expect, it } from 'vitest';

import { acceptClip, acceptanceProblems, adjustClip, editReview, mergeWithNext, newReview, nextClipId, parseManifest, keptMs, normalizeRanges, pausesInside, rejectClip, removeSection, removedMs, reopenClip, restoreSection, reviewProgress, serializeManifest, shortenPause, splitAtPause, splitClip, validateManifest, type SegmentationManifest } from './segmentation';

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

  it('merges a clip into the previous one, which keeps its own id', () => {
    const merged = mergeWithNext(fixture(), 'c001'); // what "Merge with previous" does when c002 is selected
    expect(merged.clips.map((clip) => clip.id)).toEqual(['c001', 'c003']);
    expect([merged.clips[0]!.startMs, merged.clips[0]!.endMs]).toEqual([1_000, 18_000]);
    expect(merged.clips[0]!.cutCandidatesMs).toContain(10_500); // the old boundary stays a cut point
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

  it('splits inside a silence and drops most of it', () => {
    const merged = mergeWithNext(fixture(), 'c002'); // c002 now spans 12_000 -> 33_000
    const split = splitAtPause(merged, 'c002', { startMs: 18_000, endMs: 30_000 }, 150);
    const [left, right] = [split.clips[1]!, split.clips[2]!];
    expect([left.id, left.startMs, left.endMs]).toEqual(['c002', 12_000, 18_150]);
    expect([right.id, right.startMs, right.endMs]).toEqual(['c003', 29_850, 33_000]);
    expect(right.startMs - left.endMs).toBe(11_700); // the silence belongs to neither clip
    expect(left.review.status).toBe('proposed');
    expect(left.flags).not.toContain('long_internal_pause');
  });

  it('refuses a silence split that would leave a tiny part or sit outside the clip', () => {
    const manifest = fixture();
    expect(() => splitAtPause(manifest, 'c001', { startMs: 1_000, endMs: 1_900 })).toThrow(/not inside/);
    expect(() => splitAtPause(manifest, 'c001', { startMs: 1_100, endMs: 8_000 }, 150)).toThrow(/at least/);
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
  it('accepts without a transcript, defaulting to the ASR tier', () => {
    expect(acceptanceProblems(newReview())).toEqual(['Choose a tier.']);
    const manifest = acceptClip(fixture(), 'c001', 'Amani', NOW);
    expect(manifest.clips[0]!.review).toMatchObject({ status: 'accepted', transcript: null, tier: 'asr', reviewedBy: 'Amani', reviewedAt: NOW.toISOString() });
    validateManifest(manifest);
  });

  it('requires confirmed no-music before a clip joins the TTS tier and trims any transcript', () => {
    let manifest = editReview(fixture(), 'c001', { transcript: '  mbote  ', tier: 'asr_tts', hasMusic: null });
    expect(() => acceptClip(manifest, 'c001', 'Amani', NOW)).toThrow(/free of music/);
    manifest = editReview(manifest, 'c001', { hasMusic: false });
    manifest = acceptClip(manifest, 'c001', 'Amani', NOW);
    expect(manifest.clips[0]!.review).toMatchObject({ status: 'accepted', transcript: 'mbote', tier: 'asr_tts' });
  });

  it('demotes an accepted clip when an edit makes it invalid', () => {
    let manifest = editReview(fixture(), 'c001', { tier: 'asr_tts', hasMusic: false });
    manifest = acceptClip(manifest, 'c001', 'A', NOW);
    manifest = editReview(manifest, 'c001', { hasMusic: null });
    expect(manifest.clips[0]!.review.status).toBe('proposed');
  });

  it('rejects with a reason and can be reopened', () => {
    expect(() => rejectClip(fixture(), 'c002', '  ', 'A', NOW)).toThrow(/reason/);
    let manifest = rejectClip(fixture(), 'c002', 'music only', 'A', NOW);
    expect(manifest.clips[1]!.review.status).toBe('rejected');
    manifest = reopenClip(manifest, 'c002');
    expect(manifest.clips[1]!.review).toMatchObject({ status: 'proposed', rejectReason: null });
  });

  it('keeps a speaker role and name editable after accepting, without reopening the clip', () => {
    let manifest = acceptClip(fixture(), 'c001', 'A', NOW);
    manifest = editReview(manifest, 'c001', { speakerRole: 'narrator' });
    manifest = editReview(manifest, 'c001', { speaker: 'voice A' });
    expect(manifest.clips[0]!.review).toMatchObject({ status: 'accepted', speakerRole: 'narrator', speaker: 'voice A' });
    manifest = editReview(manifest, 'c001', { speakerRole: 'character', speaker: 'Peter' });
    expect(manifest.clips[0]!.review).toMatchObject({ status: 'accepted', speakerRole: 'character', speaker: 'Peter' });
    expect(parseManifest(serializeManifest(manifest)).clips[0]!.review.speakerRole).toBe('character');
  });

  it('rejects an unknown speaker role and still reads older manifests without the field', () => {
    const raw = JSON.parse(serializeManifest(fixture()));
    delete raw.clips[0].review.speakerRole;
    expect(parseManifest(JSON.stringify(raw)).clips[0]!.review.speakerRole).toBeUndefined();
    raw.clips[0].review.speakerRole = 'actor';
    expect(() => parseManifest(JSON.stringify(raw))).toThrow();
  });

  it('finds the silences inside a clip that the TTS export shortens', () => {
    const base = fixture();
    const manifest = { ...base, speechSpans: [{ startMs: 1_200, endMs: 2_000 }, { startMs: 4_600, endMs: 6_000 }, { startMs: 6_800, endMs: 8_500 }, { startMs: 12_500, endMs: 13_000 }] };
    const pauses = pausesInside(manifest, manifest.clips[0]!, 500);
    expect(pauses.map((pause) => pause.lengthMs)).toEqual([2_600, 800]);
    expect(pauses[0]).toMatchObject({ startMs: 2_000, endMs: 4_600 });
    expect(pausesInside(manifest, manifest.clips[0]!, 3_000)).toEqual([]);
    expect(pausesInside(manifest, manifest.clips[2]!, 500)).toEqual([]);
  });

  it('summarises progress', () => {
    let manifest = editReview(fixture(), 'c001', { transcript: 'x', tier: 'asr_tts', hasMusic: false });
    manifest = acceptClip(manifest, 'c001', 'A', NOW);
    manifest = rejectClip(manifest, 'c003', 'not speech', 'A', NOW);
    expect(reviewProgress(manifest)).toEqual({ total: 3, accepted: 1, rejected: 1, proposed: 1, tts: 1, acceptedSeconds: 8 });
  });
});

describe('removing sections from a clip', () => {
  it('removes a stretch, keeps the clip range, and counts only what remains', () => {
    const manifest = removeSection(fixture(), 'c001', { startMs: 3_000, endMs: 5_000 });
    const clip = manifest.clips[0]!;
    expect(clip.removed).toEqual([{ startMs: 3_000, endMs: 5_000 }]);
    expect([clip.startMs, clip.endMs, clip.durationMs]).toEqual([1_000, 9_000, 8_000]);
    expect([removedMs(clip), keptMs(clip)]).toEqual([2_000, 6_000]);
    expect(parseManifest(serializeManifest(manifest)).clips[0]!.removed).toEqual([{ startMs: 3_000, endMs: 5_000 }]);
  });

  it('merges overlapping and touching removals', () => {
    let manifest = removeSection(fixture(), 'c001', { startMs: 3_000, endMs: 4_000 });
    manifest = removeSection(manifest, 'c001', { startMs: 3_800, endMs: 5_000 });
    manifest = removeSection(manifest, 'c001', { startMs: 5_000, endMs: 5_500 });
    expect(manifest.clips[0]!.removed).toEqual([{ startMs: 3_000, endMs: 5_500 }]);
    expect(normalizeRanges([{ startMs: 5, endMs: 9 }, { startMs: 1, endMs: 3 }, { startMs: 2, endMs: 6 }], 0, 8)).toEqual([{ startMs: 1, endMs: 8 }]);
  });

  it('judges length, flags and the TTS tag by what remains after removal', () => {
    const longer = adjustClip(fixture(), 'c003', 30_000, 44_000);              // 14 s, past the 12 s target
    expect(longer.clips[2]!.flags).toEqual(['over_target']);
    const trimmed = removeSection(longer, 'c003', { startMs: 32_000, endMs: 38_000 });   // 8 s left
    expect(trimmed.clips[2]!.durationMs).toBe(14_000);
    expect(trimmed.clips[2]!.flags).toEqual(['tts_length_ok']);
    expect(() => removeSection(trimmed, 'c003', { startMs: 30_100, endMs: 44_000 })).toThrow(/less than 500 ms/);
  });

  it('refuses sections that are outside the clip, tiny, or not whole milliseconds', () => {
    const manifest = fixture();
    expect(() => removeSection(manifest, 'c001', { startMs: 500, endMs: 3_000 })).toThrow(/inside this clip/);
    expect(() => removeSection(manifest, 'c001', { startMs: 3_000, endMs: 9_500 })).toThrow(/inside this clip/);
    expect(() => removeSection(manifest, 'c001', { startMs: 3_000, endMs: 3_010 })).toThrow(/longer section/);
    expect(() => removeSection(manifest, 'c001', { startMs: 3_000.5, endMs: 5_000 })).toThrow(/whole milliseconds/);
  });

  it('sends an accepted clip back to review, and restoring a section does too', () => {
    let manifest = acceptClip(fixture(), 'c001', 'A', NOW);
    manifest = removeSection(manifest, 'c001', { startMs: 3_000, endMs: 5_000 });
    expect(manifest.clips[0]!.review.status).toBe('proposed');
    manifest = acceptClip(manifest, 'c001', 'A', NOW);
    manifest = restoreSection(manifest, 'c001', { startMs: 3_000, endMs: 5_000 });
    expect(manifest.clips[0]!.removed).toBeUndefined();
    expect(manifest.clips[0]!.review.status).toBe('proposed');
    expect(() => restoreSection(manifest, 'c001', { startMs: 1, endMs: 2 })).toThrow(/not removed/);
  });

  it('shortens a silence to the amount you keep, from both sides', () => {
    const base = fixture();
    const manifest = { ...base, speechSpans: [{ startMs: 1_200, endMs: 2_000 }, { startMs: 6_000, endMs: 7_000 }] };
    const pause = pausesInside(manifest, manifest.clips[0]!, 500)[0]!;
    expect(pause.lengthMs).toBe(4_000);
    const shortened = shortenPause(manifest, 'c001', pause, 300);
    expect(shortened.clips[0]!.removed).toEqual([{ startMs: 2_150, endMs: 5_850 }]);
    expect(pausesInside(shortened, shortened.clips[0]!, 100)[0]!.lengthMs).toBe(300);   // what is left of the silence
    expect(pausesInside(shortened, shortened.clips[0]!, 500)).toEqual([]);              // no longer needs attention
    expect(() => shortenPause(shortened, 'c001', pause, 300)).not.toThrow();           // shortening again is harmless
    expect(() => shortenPause(manifest, 'c001', { startMs: 2_000, endMs: 2_200 }, 300)).toThrow(/already short/);
  });

  it('keeps removed sections with the right half when a clip is split, and joins them when merged', () => {
    let manifest = removeSection(fixture(), 'c001', { startMs: 3_000, endMs: 7_000 });
    const split = splitClip(manifest, 'c001', 5_000);
    expect(split.clips[0]!.removed).toEqual([{ startMs: 3_000, endMs: 5_000 }]);
    expect(split.clips[1]!.removed).toEqual([{ startMs: 5_000, endMs: 7_000 }]);
    manifest = removeSection(fixture(), 'c002', { startMs: 14_000, endMs: 15_000 });
    const merged = mergeWithNext(removeSection(manifest, 'c001', { startMs: 3_000, endMs: 4_000 }), 'c001');
    expect(merged.clips[0]!.removed).toEqual([{ startMs: 3_000, endMs: 4_000 }, { startMs: 14_000, endMs: 15_000 }]);
  });

  it('drops removed sections that fall outside new edges', () => {
    const manifest = removeSection(fixture(), 'c001', { startMs: 1_500, endMs: 2_500 });
    const trimmed = adjustClip(manifest, 'c001', 4_000, 9_000);
    expect(trimmed.clips[0]!.removed).toBeUndefined();
    const clamped = adjustClip(manifest, 'c001', 2_000, 9_000);
    expect(clamped.clips[0]!.removed).toEqual([{ startMs: 2_000, endMs: 2_500 }]);
  });

  it('subtracts removed time from the silence shown to the reviewer', () => {
    const base = fixture();
    const manifest = { ...base, speechSpans: [{ startMs: 1_200, endMs: 2_000 }, { startMs: 6_000, endMs: 7_000 }] };
    const part = removeSection(manifest, 'c001', { startMs: 3_000, endMs: 4_000 });
    expect(pausesInside(part, part.clips[0]!, 500)[0]!.lengthMs).toBe(3_000);
  });

  it('rejects a manifest whose removed sections are invalid', () => {
    const raw = JSON.parse(serializeManifest(removeSection(fixture(), 'c001', { startMs: 3_000, endMs: 4_000 })));
    raw.clips[0].removed = [{ startMs: 500, endMs: 2_000 }];
    expect(() => parseManifest(JSON.stringify(raw))).toThrow(/inside the clip/);
    raw.clips[0].removed = [{ startMs: 4_000, endMs: 5_000 }, { startMs: 3_000, endMs: 3_500 }];
    expect(() => parseManifest(JSON.stringify(raw))).toThrow(/in order/);
  });
});
