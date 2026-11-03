"""ffmpeg and WAV helpers. The master media file is only ever read."""

from __future__ import annotations

import hashlib
import math
import subprocess
import wave
from pathlib import Path

import numpy as np

WORKING_SAMPLE_RATE = 16000


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def run(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{command[0]} failed: {result.stderr.strip()[-600:]}")
    return result.stdout


def ffmpeg_version() -> str:
    return run(["ffmpeg", "-version"]).splitlines()[0]


def probe_duration_ms(path: Path) -> int:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)])
    return round(float(out.strip()) * 1000)


def extract_working_wav(source: Path, target: Path) -> None:
    """Mono 16 kHz 16-bit PCM copy of the audio track, used for detection and review."""
    target.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-y", "-v", "error", "-i", str(source), "-vn", "-ac", "1",
         "-ar", str(WORKING_SAMPLE_RATE), "-c:a", "pcm_s16le", str(target)])


def read_wav_int16(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2:
            raise ValueError("Working audio must be mono 16-bit PCM.")
        rate = handle.getframerate()
        data = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16)
    return data, rate


def _db(value: float) -> float:
    return round(20 * math.log10(max(value, 1e-9)), 1)


def clip_metrics(samples: np.ndarray, rate: int, start_ms: int, end_ms: int) -> dict:
    """Loudness and clipping for a clip; informational flags for the reviewer."""
    chunk = samples[int(start_ms * rate / 1000): int(end_ms * rate / 1000)].astype(np.float64) / 32768.0
    if chunk.size == 0:
        return {"rmsDb": -90.0, "peakDb": -90.0, "clippedRatio": 0.0}
    return {
        "rmsDb": _db(float(np.sqrt(np.mean(chunk ** 2)))),
        "peakDb": _db(float(np.max(np.abs(chunk)))),
        "clippedRatio": round(float(np.mean(np.abs(chunk) >= 0.999)), 5),
    }


def cut_clip(source: Path, target: Path, start_ms: int, end_ms: int, sample_rate: int) -> None:
    """Cut a clip from the original media at its own quality, mono 16-bit PCM."""
    target.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-y", "-v", "error", "-i", str(source), "-ss", f"{start_ms / 1000:.3f}",
         "-t", f"{(end_ms - start_ms) / 1000:.3f}", "-vn", "-ac", "1", "-ar", str(sample_rate),
         "-c:a", "pcm_s16le", str(target)])
