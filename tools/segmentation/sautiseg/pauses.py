"""Shorten long silences inside a clip. Pure logic; works on the speech spans the VAD found."""

from __future__ import annotations

import numpy as np

Span = tuple[int, int]
FADE_MS = 5


def keep_ranges(spans: list[Span], start_ms: int, end_ms: int, max_pause_ms: int) -> list[Span]:
    """Parts of [start_ms, end_ms] to keep so no silence between speech exceeds max_pause_ms.

    Only the middle of an over-long silence is dropped; half of the allowed pause stays on each side
    of the cut, so nothing audible is removed. Edge padding before the first and after the last
    speech span is left alone. max_pause_ms <= 0 keeps everything.
    """
    if max_pause_ms <= 0:
        return [(start_ms, end_ms)]
    inside = sorted((max(a, start_ms), min(b, end_ms)) for a, b in spans if b > start_ms and a < end_ms)
    ranges: list[Span] = []
    cursor = start_ms
    half = max_pause_ms // 2
    for (_, first_end), (second_start, _) in zip(inside, inside[1:]):
        if second_start - first_end > max_pause_ms:
            ranges.append((cursor, first_end + half))
            cursor = second_start - (max_pause_ms - half)
    ranges.append((cursor, end_ms))
    return ranges


def kept_ms(ranges: list[Span]) -> int:
    return sum(end - start for start, end in ranges)


def assemble(samples: np.ndarray, rate: int, ranges: list[Span]) -> np.ndarray:
    """Join the kept ranges, with a few milliseconds of fade at each join to avoid clicks."""
    fade = max(1, int(rate * FADE_MS / 1000))
    pieces = []
    for index, (start, end) in enumerate(ranges):
        piece = samples[int(start * rate / 1000): int(end * rate / 1000)].astype(np.float32).copy()
        if index > 0 and piece.size >= fade:
            piece[:fade] *= np.linspace(0.0, 1.0, fade, dtype=np.float32)
        if index < len(ranges) - 1 and piece.size >= fade:
            piece[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
        pieces.append(piece)
    return np.concatenate(pieces) if pieces else samples[:0].astype(np.float32)
