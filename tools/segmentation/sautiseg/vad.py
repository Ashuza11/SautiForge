"""Silero VAD wrapper. Detection only: it proposes speech spans, a human decides."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from .clips import Span


@dataclass(frozen=True)
class VadParams:
    threshold: float = 0.5
    min_speech_ms: int = 250
    min_silence_ms: int = 300
    max_speech_s: float = 20.0   # Silero splits longer speech at its longest internal silence

    def as_dict(self) -> dict:
        return asdict(self)


WINDOW = 512  # samples per probability window at 16 kHz (32 ms)


def detect(samples: np.ndarray, rate: int, params: VadParams) -> tuple[list[Span], np.ndarray]:
    """Return speech spans (ms) and the per-window speech probability."""
    import torch
    from silero_vad import get_speech_timestamps, load_silero_vad

    if rate != 16000:
        raise ValueError("Silero VAD in this tool expects 16 kHz audio.")
    torch.set_num_threads(2)
    model = load_silero_vad()
    wav = torch.from_numpy(samples.astype(np.float32) / 32768.0)

    stamps = get_speech_timestamps(
        wav, model, threshold=params.threshold, sampling_rate=rate,
        min_speech_duration_ms=params.min_speech_ms, max_speech_duration_s=params.max_speech_s,
        min_silence_duration_ms=params.min_silence_ms, speech_pad_ms=0, return_seconds=False,
    )
    spans = [(round(s["start"] * 1000 / rate), round(s["end"] * 1000 / rate)) for s in stamps]

    model.reset_states()
    probs = []
    with torch.no_grad():
        for i in range(0, len(wav) - WINDOW + 1, WINDOW):
            probs.append(float(model(wav[i:i + WINDOW], rate).item()))
    model.reset_states()
    return spans, np.asarray(probs, dtype=np.float32)


def speech_stats(probs: np.ndarray, start_ms: int, end_ms: int, threshold: float) -> dict:
    """Mean speech probability and share of speech windows inside a clip."""
    per_ms = 1000 * WINDOW / 16000  # 32 ms
    window = probs[int(start_ms / per_ms): max(int(start_ms / per_ms) + 1, int(end_ms / per_ms))]
    if window.size == 0:
        return {"meanSpeechProb": 0.0, "speechRatio": 0.0}
    return {"meanSpeechProb": round(float(window.mean()), 3),
            "speechRatio": round(float((window >= threshold).mean()), 3)}
