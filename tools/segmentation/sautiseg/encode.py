"""Lossless FLAC masters and small Opus listening copies for published clips."""

from __future__ import annotations

import hashlib
import subprocess
import wave
from pathlib import Path

from .audio import probe_duration_ms, run

OPUS_BITRATE = "24k"
OPUS_RATE = 48000
_BITEXACT = ["-fflags", "+bitexact", "-flags:a", "+bitexact"]


def encode_flac(wav: Path, target: Path) -> None:
    """WAV -> FLAC with no metadata, so the same audio always gives the same file."""
    run(["ffmpeg", "-y", "-v", "error", "-i", str(wav), *_BITEXACT, "-map_metadata", "-1", "-c:a", "flac", "-compression_level", "8", str(target)])


def decode_flac_to_wav(flac: Path, wav: Path) -> None:
    """FLAC -> 16-bit PCM WAV. The audio samples are exactly those that were encoded."""
    run(["ffmpeg", "-y", "-v", "error", "-i", str(flac), *_BITEXACT, "-map_metadata", "-1", "-c:a", "pcm_s16le", str(wav)])


def pcm_sha256(wav: Path) -> str:
    """SHA-256 of the 16-bit samples only. WAV headers carry tool versions, so the file hash is not portable."""
    with wave.open(str(wav), "rb") as handle:
        if handle.getsampwidth() != 2:
            raise RuntimeError(f"{wav.name}: expected 16-bit audio.")
        return hashlib.sha256(handle.readframes(handle.getnframes())).hexdigest()


def decoded_pcm_sha256(flac: Path, channels: int = 1) -> str:
    """Decode a FLAC to raw 16-bit samples and hash them."""
    result = subprocess.run(["ffmpeg", "-v", "error", "-i", str(flac), "-f", "s16le", "-acodec", "pcm_s16le", "-ac", str(channels), "-"],
                            capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed to decode {flac.name}: {result.stderr.decode(errors='replace').strip()[-300:]}")
    return hashlib.sha256(result.stdout).hexdigest()


def encode_opus(wav: Path, target: Path) -> None:
    """A small speech-quality copy for listening on a phone; never used as dataset audio."""
    run(["ffmpeg", "-y", "-v", "error", "-i", str(wav), *_BITEXACT, "-map_metadata", "-1", "-ac", "1", "-ar", str(OPUS_RATE),
         "-c:a", "libopus", "-b:a", OPUS_BITRATE, "-application", "voip", str(target)])


def verify_flac_round_trip(wav: Path, flac: Path) -> str:
    """The master must decode back to exactly the same samples as the export, or it is not a safe copy.

    Returns the samples' SHA-256, which is stored so the dataset export can repeat this check.
    """
    expected = pcm_sha256(wav)
    if decoded_pcm_sha256(flac) != expected:
        raise RuntimeError(f"{wav.name}: the FLAC does not decode back to the same audio samples. Not publishing it.")
    return expected


def duration_ms(path: Path) -> int:
    return probe_duration_ms(path)
