"""Group voice-activity spans into clip proposals.

Pure logic with no audio or model dependency. A clip boundary is only ever
placed in a pause between two detected speech spans, never inside a span, so a
phrase is never cut. All times are integer milliseconds on the source timeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field

Span = tuple[int, int]


@dataclass(frozen=True)
class ClipParams:
    min_clip_ms: int = 1500          # shorter clips are flagged, not dropped
    min_preferred_ms: int = 3000     # do not close a group at a pause before this length
    target_max_ms: int = 12000       # preferred ceiling (TTS-friendly)
    hard_max_ms: int = 20000         # absolute ceiling; longer needs a manual split
    sentence_pause_ms: int = 700     # a pause this long is treated as a sentence boundary
    max_gap_ms: int = 1000           # never join speech across a longer silence
    long_pause_ms: int = 1000        # a silence this long inside a clip is flagged (bad for TTS)
    pad_ms: int = 150                # silence kept on each side, never into a neighbour

    def validate(self) -> None:
        if not 0 < self.min_clip_ms <= self.min_preferred_ms <= self.target_max_ms <= self.hard_max_ms:
            raise ValueError("Require 0 < min_clip <= min_preferred <= target_max <= hard_max.")
        if self.sentence_pause_ms < 0 or self.pad_ms < 0:
            raise ValueError("Pause and padding must not be negative.")
        if self.max_gap_ms < self.sentence_pause_ms:
            raise ValueError("max_gap must be at least the sentence pause.")


@dataclass
class Clip:
    index: int
    start_ms: int
    end_ms: int
    speech_start_ms: int
    speech_end_ms: int
    span_count: int
    cut_candidates_ms: list[int] = field(default_factory=list)
    max_internal_gap_ms: int = 0
    flags: list[str] = field(default_factory=list)

    @property
    def id(self) -> str:
        return f"c{self.index:03d}"

    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms


def normalize_spans(spans: list[Span], total_ms: int) -> list[Span]:
    """Sort, clamp to the file, drop empty spans and merge overlaps."""
    cleaned = sorted((max(0, s), min(total_ms, e)) for s, e in spans if e > s)
    merged: list[Span] = []
    for start, end in cleaned:
        if start >= end:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def build_clips(spans: list[Span], total_ms: int, params: ClipParams = ClipParams()) -> list[Clip]:
    params.validate()
    spans = normalize_spans(spans, total_ms)
    if not spans:
        return []

    groups: list[list[Span]] = []
    current: list[Span] = [spans[0]]
    for span in spans[1:]:
        group_start = current[0][0]
        group_ms = current[-1][1] - group_start
        projected_ms = span[1] - group_start
        gap_ms = span[0] - current[-1][1]

        too_long = projected_ms > params.target_max_ms
        # A very short group may stretch to the hard ceiling rather than become a fragment.
        if too_long and group_ms < params.min_clip_ms and projected_ms <= params.hard_max_ms:
            too_long = False
        sentence_break = gap_ms >= params.sentence_pause_ms and group_ms >= params.min_preferred_ms

        if too_long or sentence_break or gap_ms > params.max_gap_ms:
            groups.append(current)
            current = [span]
        else:
            current.append(span)
    groups.append(current)

    clips: list[Clip] = []
    for i, group in enumerate(groups):
        speech_start, speech_end = group[0][0], group[-1][1]
        prev_end = groups[i - 1][-1][1] if i > 0 else None
        next_start = groups[i + 1][0][0] if i + 1 < len(groups) else None

        start = max(0, speech_start - params.pad_ms)
        if prev_end is not None:
            start = max(start, (prev_end + speech_start) // 2)
        end = min(total_ms, speech_end + params.pad_ms)
        if next_start is not None:
            end = min(end, (speech_end + next_start) // 2)

        candidates = [(a[1] + b[0]) // 2 for a, b in zip(group, group[1:])]
        clip = Clip(
            index=i + 1, start_ms=start, end_ms=end,
            speech_start_ms=speech_start, speech_end_ms=speech_end,
            span_count=len(group), cut_candidates_ms=candidates,
            max_internal_gap_ms=max((b[0] - a[1] for a, b in zip(group, group[1:])), default=0),
        )
        clip.flags = flag_clip(clip, params)
        clips.append(clip)
    return clips


def flag_clip(clip: Clip, params: ClipParams) -> list[str]:
    flags: list[str] = []
    ms = clip.duration_ms
    if ms < params.min_clip_ms:
        flags.append("too_short")
    if ms > params.hard_max_ms:
        flags.append("needs_manual_split")
    elif ms > params.target_max_ms:
        flags.append("over_target")
    if clip.max_internal_gap_ms > params.long_pause_ms:
        flags.append("long_internal_pause")
    if 2000 <= ms <= params.target_max_ms:
        flags.append("tts_length_ok")
    return flags
