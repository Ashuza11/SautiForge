import { z } from 'zod';

export const SEGMENTATION_SCHEMA = 'sautiforge.segmentation/1';
export const MIN_CLIP_MS = 500;

const DEFAULT_LIMITS = { min_clip_ms: 1_500, target_max_ms: 12_000, hard_max_ms: 20_000 };
const DURATION_FLAGS = ['too_short', 'over_target', 'needs_manual_split', 'tts_length_ok'];
const LONG_PAUSE_MS = 1_000;

export const clipReviewSchema = z.object({
  status: z.enum(['proposed', 'accepted', 'rejected']),
  transcript: z.string().nullable(),
  speaker: z.string().nullable(),
  hasMusic: z.boolean().nullable(),
  tier: z.enum(['asr', 'asr_tts']).nullable(),
  rejectReason: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
}).strict();

export const clipSchema = z.object({
  id: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  speechStartMs: z.number().int().nonnegative(),
  speechEndMs: z.number().int().positive(),
  spanCount: z.number().int().nonnegative(),
  cutCandidatesMs: z.array(z.number().int()),
  flags: z.array(z.string()),
  metrics: z.record(z.string(), z.number()),
  review: clipReviewSchema,
}).passthrough();

export const segmentationManifestSchema = z.object({
  schema: z.literal(SEGMENTATION_SCHEMA),
  createdAt: z.string(),
  source: z.object({
    fileName: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    durationMs: z.number().int().positive(),
    workingAudio: z.string().min(1),
    workingSampleRate: z.number().int().positive(),
    vocalsAudio: z.string().min(1).optional(),
  }).passthrough(),
  processing: z.record(z.string(), z.unknown()),
  speechSpans: z.array(z.object({ startMs: z.number(), endMs: z.number() })),
  clips: z.array(clipSchema),
}).passthrough();

export type ClipReview = z.infer<typeof clipReviewSchema>;
export type SegmentClip = z.infer<typeof clipSchema>;
export type SegmentationManifest = z.infer<typeof segmentationManifestSchema>;

export const rejectReasons = ['music only', 'overlapping speech', 'not speech', 'unclear audio', 'cut mid-phrase', 'other language', 'other'] as const;

export function newReview(): ClipReview {
  return { status: 'proposed', transcript: null, speaker: null, hasMusic: null, tier: null, rejectReason: null, reviewedBy: null, reviewedAt: null };
}

/** Same acceptance rules as the Python exporter; empty means the clip can be accepted. A transcript is optional: community annotators write it later. */
export function acceptanceProblems(review: ClipReview): string[] {
  const problems: string[] = [];
  if (!review.tier) problems.push('Choose a tier.');
  if (review.tier === 'asr_tts' && review.hasMusic !== false) problems.push('TTS clips must be confirmed free of music.');
  return problems;
}

export function validateManifest(manifest: SegmentationManifest): void {
  const total = manifest.source.durationMs;
  const seen = new Set<string>();
  let previousEnd = 0;
  for (const clip of manifest.clips) {
    if (seen.has(clip.id)) throw new Error(`Duplicate clip id ${clip.id}.`);
    seen.add(clip.id);
    if (!(clip.startMs >= 0 && clip.startMs < clip.endMs && clip.endMs <= total)) throw new Error(`${clip.id}: boundaries must fit inside the source.`);
    if (clip.durationMs !== clip.endMs - clip.startMs) throw new Error(`${clip.id}: duration does not match its boundaries.`);
    if (clip.startMs < previousEnd) throw new Error(`${clip.id}: overlaps the previous clip.`);
    previousEnd = clip.endMs;
    if (clip.review.status === 'accepted') {
      const problems = acceptanceProblems(clip.review);
      if (problems.length) throw new Error(`${clip.id}: ${problems.join(' ')}`);
    }
    if (clip.review.status === 'rejected' && !clip.review.rejectReason) throw new Error(`${clip.id}: a rejected clip needs a reason.`);
  }
}

export function parseManifest(text: string): SegmentationManifest {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('manifest.json is not valid JSON.'); }
  const result = segmentationManifestSchema.safeParse(raw);
  if (!result.success) throw new Error(`This is not a SautiForge segmentation manifest: ${result.error.issues[0]?.message ?? 'invalid'} (${result.error.issues[0]?.path.join('.') ?? ''}).`);
  validateManifest(result.data);
  return result.data;
}

export function serializeManifest(manifest: SegmentationManifest): string {
  validateManifest(manifest);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function limits(manifest: SegmentationManifest) {
  const configured = (manifest.processing.clips ?? {}) as Partial<typeof DEFAULT_LIMITS>;
  return { ...DEFAULT_LIMITS, ...configured };
}

function recomputeFlags(clip: SegmentClip, manifest: SegmentationManifest): string[] {
  const { min_clip_ms, target_max_ms, hard_max_ms } = limits(manifest);
  const kept = clip.flags.filter((flag) => !DURATION_FLAGS.includes(flag));
  if (clip.durationMs < min_clip_ms) kept.push('too_short');
  if (clip.durationMs > hard_max_ms) kept.push('needs_manual_split');
  else if (clip.durationMs > target_max_ms) kept.push('over_target');
  if (clip.durationMs >= 2_000 && clip.durationMs <= target_max_ms) kept.push('tts_length_ok');
  return kept;
}

function rebuild(manifest: SegmentationManifest, clips: SegmentClip[]): SegmentationManifest {
  const sorted = [...clips].sort((a, b) => a.startMs - b.startMs);
  const next = { ...manifest, clips: sorted };
  validateManifest(next);
  return next;
}

function withBounds(clip: SegmentClip, startMs: number, endMs: number, manifest: SegmentationManifest): SegmentClip {
  const bounded = {
    ...clip, startMs, endMs, durationMs: endMs - startMs,
    speechStartMs: Math.min(Math.max(clip.speechStartMs, startMs), endMs),
    speechEndMs: Math.min(Math.max(clip.speechEndMs, startMs + 1), endMs),
    cutCandidatesMs: clip.cutCandidatesMs.filter((at) => at > startMs + MIN_CLIP_MS && at < endMs - MIN_CLIP_MS),
  };
  return { ...bounded, flags: recomputeFlags(bounded, manifest) };
}

function find(manifest: SegmentationManifest, id: string): number {
  const index = manifest.clips.findIndex((clip) => clip.id === id);
  if (index < 0) throw new Error(`Unknown clip ${id}.`);
  return index;
}

/** Move a clip's edges. A boundary change invalidates a previous acceptance. */
export function adjustClip(manifest: SegmentationManifest, id: string, startMs: number, endMs: number): SegmentationManifest {
  const index = find(manifest, id);
  const clip = manifest.clips[index]!;
  const total = manifest.source.durationMs;
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs)) throw new Error('Boundaries must be whole milliseconds.');
  if (startMs < 0 || endMs > total) throw new Error('A clip must stay inside the source.');
  if (endMs - startMs < MIN_CLIP_MS) throw new Error(`A clip must be at least ${MIN_CLIP_MS} ms long.`);
  const previous = manifest.clips[index - 1];
  const following = manifest.clips[index + 1];
  if (previous && startMs < previous.endMs) throw new Error('This would overlap the previous clip.');
  if (following && endMs > following.startMs) throw new Error('This would overlap the next clip.');
  if (startMs === clip.startMs && endMs === clip.endMs) return manifest;
  const moved = withBounds(clip, startMs, endMs, manifest);
  const review = clip.review.status === 'accepted' ? { ...clip.review, status: 'proposed' as const, reviewedAt: null } : clip.review;
  return rebuild(manifest, manifest.clips.map((item, i) => (i === index ? { ...moved, review } : item)));
}

export function nextClipId(manifest: SegmentationManifest): string {
  const max = manifest.clips.reduce((highest, clip) => Math.max(highest, Number(/^c(\d+)$/.exec(clip.id)?.[1] ?? 0)), 0);
  return `c${String(max + 1).padStart(3, '0')}`;
}

/** Split one clip into two touching clips at a pause. Both return to review. */
export function splitClip(manifest: SegmentationManifest, id: string, atMs: number): SegmentationManifest {
  const index = find(manifest, id);
  const clip = manifest.clips[index]!;
  if (!Number.isInteger(atMs) || atMs < clip.startMs + MIN_CLIP_MS || atMs > clip.endMs - MIN_CLIP_MS) {
    throw new Error(`Split at least ${MIN_CLIP_MS} ms away from both edges.`);
  }
  const base = { ...clip, review: newReview(), metrics: {}, flags: clip.flags.filter((flag) => !DURATION_FLAGS.includes(flag) && flag !== 'long_internal_pause') };
  const left = withBounds({ ...base, cutCandidatesMs: clip.cutCandidatesMs.filter((at) => at < atMs) }, clip.startMs, atMs, manifest);
  const right = withBounds({ ...base, id: nextClipId(manifest), cutCandidatesMs: clip.cutCandidatesMs.filter((at) => at > atMs) }, atMs, clip.endMs, manifest);
  return rebuild(manifest, [...manifest.clips.slice(0, index), left, right, ...manifest.clips.slice(index + 1)]);
}

/**
 * Split inside a silence and drop most of it: the left clip keeps padMs after the speech, the right clip
 * starts padMs before the next speech. The audio between them belongs to neither clip. Both return to review.
 */
export function splitAtPause(manifest: SegmentationManifest, id: string, pause: { startMs: number; endMs: number }, padMs = 150): SegmentationManifest {
  const index = find(manifest, id);
  const clip = manifest.clips[index]!;
  if (pause.startMs <= clip.startMs || pause.endMs >= clip.endMs) throw new Error('That silence is not inside this clip.');
  const middle = Math.round((pause.startMs + pause.endMs) / 2);
  const leftEnd = Math.min(pause.startMs + padMs, middle);
  const rightStart = Math.max(pause.endMs - padMs, middle);
  if (leftEnd - clip.startMs < MIN_CLIP_MS || clip.endMs - rightStart < MIN_CLIP_MS) {
    throw new Error(`Both parts must be at least ${MIN_CLIP_MS} ms long. Merge or move the edges first.`);
  }
  const base = { ...clip, review: newReview(), metrics: {}, flags: clip.flags.filter((flag) => !DURATION_FLAGS.includes(flag) && flag !== 'long_internal_pause') };
  const left = withBounds({ ...base, cutCandidatesMs: clip.cutCandidatesMs.filter((at) => at < leftEnd) }, clip.startMs, leftEnd, manifest);
  const right = withBounds({ ...base, id: nextClipId(manifest), cutCandidatesMs: clip.cutCandidatesMs.filter((at) => at > rightStart) }, rightStart, clip.endMs, manifest);
  return rebuild(manifest, [...manifest.clips.slice(0, index), left, right, ...manifest.clips.slice(index + 1)]);
}

/** Merge a clip with the one after it; the pause between them becomes a cut candidate. */
export function mergeWithNext(manifest: SegmentationManifest, id: string): SegmentationManifest {
  const index = find(manifest, id);
  const first = manifest.clips[index]!;
  const second = manifest.clips[index + 1];
  if (!second) throw new Error('There is no following clip to merge with.');
  const gapMs = second.startMs - first.endMs;
  const joinedFlags = [...first.flags, ...second.flags.filter((flag) => !first.flags.includes(flag))];
  const joined = withBounds({
    ...first, review: newReview(), metrics: {},
    flags: gapMs > LONG_PAUSE_MS && !joinedFlags.includes('long_internal_pause') ? [...joinedFlags, 'long_internal_pause'] : joinedFlags,
    spanCount: first.spanCount + second.spanCount,
    cutCandidatesMs: [...first.cutCandidatesMs, Math.round((first.endMs + second.startMs) / 2), ...second.cutCandidatesMs],
    speechEndMs: second.speechEndMs,
  }, first.startMs, second.endMs, manifest);
  return rebuild(manifest, [...manifest.clips.slice(0, index), joined, ...manifest.clips.slice(index + 2)]);
}

function replaceReview(manifest: SegmentationManifest, id: string, review: ClipReview): SegmentationManifest {
  const index = find(manifest, id);
  return rebuild(manifest, manifest.clips.map((clip, i) => (i === index ? { ...clip, review } : clip)));
}

/** Save working notes without deciding. Accepted status is kept only if the clip stays valid. */
export function editReview(manifest: SegmentationManifest, id: string, patch: Partial<ClipReview>): SegmentationManifest {
  const clip = manifest.clips[find(manifest, id)]!;
  const merged: ClipReview = { ...clip.review, ...patch, status: clip.review.status };
  if (merged.status === 'accepted' && acceptanceProblems(merged).length) {
    return replaceReview(manifest, id, { ...merged, status: 'proposed', reviewedAt: null });
  }
  return replaceReview(manifest, id, merged);
}

export function acceptClip(manifest: SegmentationManifest, id: string, reviewer: string, now: Date): SegmentationManifest {
  const clip = manifest.clips[find(manifest, id)]!;
  const review: ClipReview = {
    ...clip.review, tier: clip.review.tier ?? 'asr', status: 'accepted', rejectReason: null,
    reviewedBy: reviewer.trim() || null, reviewedAt: now.toISOString(),
    transcript: clip.review.transcript?.trim() || null,
  };
  const problems = acceptanceProblems(review);
  if (problems.length) throw new Error(problems.join(' '));
  return replaceReview(manifest, id, review);
}

export function rejectClip(manifest: SegmentationManifest, id: string, reason: string, reviewer: string, now: Date): SegmentationManifest {
  if (!reason.trim()) throw new Error('Choose a reason for rejecting this clip.');
  const clip = manifest.clips[find(manifest, id)]!;
  return replaceReview(manifest, id, { ...clip.review, status: 'rejected', rejectReason: reason.trim(), reviewedBy: reviewer.trim() || null, reviewedAt: now.toISOString() });
}

export function reopenClip(manifest: SegmentationManifest, id: string): SegmentationManifest {
  const clip = manifest.clips[find(manifest, id)]!;
  return replaceReview(manifest, id, { ...clip.review, status: 'proposed', rejectReason: null, reviewedAt: null });
}

export interface InternalPause { startMs: number; endMs: number; lengthMs: number }

/** Silences between detected speech inside a clip, longest first. These are what the TTS export shortens. */
export function pausesInside(manifest: SegmentationManifest, clip: SegmentClip, minMs: number): InternalPause[] {
  const inside = manifest.speechSpans
    .filter((span) => span.endMs > clip.startMs && span.startMs < clip.endMs)
    .map((span) => ({ startMs: Math.max(span.startMs, clip.startMs), endMs: Math.min(span.endMs, clip.endMs) }))
    .sort((a, b) => a.startMs - b.startMs);
  const pauses: InternalPause[] = [];
  for (let i = 0; i + 1 < inside.length; i += 1) {
    const lengthMs = inside[i + 1]!.startMs - inside[i]!.endMs;
    if (lengthMs > minMs) pauses.push({ startMs: inside[i]!.endMs, endMs: inside[i + 1]!.startMs, lengthMs });
  }
  return pauses.sort((a, b) => b.lengthMs - a.lengthMs);
}

export function reviewProgress(manifest: SegmentationManifest) {
  const count = (status: ClipReview['status']) => manifest.clips.filter((clip) => clip.review.status === status).length;
  const accepted = manifest.clips.filter((clip) => clip.review.status === 'accepted');
  return {
    total: manifest.clips.length, accepted: accepted.length, rejected: count('rejected'), proposed: count('proposed'),
    tts: accepted.filter((clip) => clip.review.tier === 'asr_tts').length,
    acceptedSeconds: accepted.reduce((sum, clip) => sum + clip.durationMs, 0) / 1000,
  };
}
