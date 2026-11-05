"""Export accepted clips from the original media with hashes and metadata."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import wave

import numpy as np

from .audio import cut_clip, probe_duration_ms, run, sha256_file
from .manifest import load_manifest
from .pauses import assemble, keep_ranges, kept_ms
from .separate import write_mono_wav

COLUMNS = ["clip_id", "file", "audio_variant", "start_ms", "end_ms", "duration_s", "trimmed_ms", "sample_rate", "sha256", "transcript",
           "speaker_role", "speaker", "has_music", "tier", "source_file", "source_sha256", "source_url"]


DEFAULT_MAX_PAUSE_MS = 500


def read_mono_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2:
            raise ValueError(f"{path.name} must be mono 16-bit PCM.")
        return np.frombuffer(handle.readframes(handle.getnframes()), dtype="<i2"), handle.getframerate()


def cut_accepted(manifest_path: Path, source: Path, *, sample_rate: int = 24000, max_pause_ms: int = DEFAULT_MAX_PAUSE_MS) -> dict:
    manifest = load_manifest(manifest_path)
    src = manifest["source"]
    if sha256_file(source) != src["sha256"]:
        raise ValueError("Source file does not match the manifest SHA-256; refusing to cut the wrong media.")
    accepted = [c for c in manifest["clips"] if c["review"]["status"] == "accepted"]
    if not accepted:
        raise ValueError("No accepted clips in the manifest. Review and accept clips first.")

    stem = manifest_path.parent.name
    out = manifest_path.parent / "export"

    # TTS clips come from the music-free vocals; the originals stay untouched for ASR.
    vocals = None
    if any(c["review"]["tier"] == "asr_tts" for c in accepted):
        vocals_name = src.get("vocals44Audio")
        vocals = manifest_path.parent / vocals_name if vocals_name else None
        if not vocals or not vocals.is_file():
            raise ValueError("TTS-tier clips need the separated vocals file. Run `prepare --separate` first.")
        if sha256_file(vocals) != src.get("vocals44Sha256"):
            raise ValueError("The separated vocals file does not match the manifest SHA-256.")
    variant_name = f"vocals_{manifest['processing'].get('separation', {}).get('model', 'separated')}"

    spans = [(s["startMs"], s["endMs"]) for s in manifest.get("speechSpans", [])]
    vocals_samples, vocals_rate = read_mono_wav(vocals) if vocals else (None, 0)

    def export(clip, media: Path, folder: str, variant: str, *, shorten_pauses: bool = False) -> dict:
        review = clip["review"]
        target = out / folder / f"{stem}_{clip['id']}.wav"
        expected_ms = clip["durationMs"]
        if shorten_pauses and max_pause_ms > 0:
            # TTS copy only: cap silences between speech at max_pause_ms. The original audio is never altered.
            ranges = keep_ranges(spans, clip["startMs"], clip["endMs"], max_pause_ms)
            expected_ms = kept_ms(ranges)
            temp = target.with_name(f".{target.stem}_full.wav")
            write_mono_wav(temp, assemble(vocals_samples, vocals_rate, ranges) / 32768.0, vocals_rate)
            run(["ffmpeg", "-y", "-v", "error", "-i", str(temp), "-ac", "1", "-ar", str(sample_rate), "-c:a", "pcm_s16le", str(target)])
            temp.unlink()
        else:
            cut_clip(media, target, clip["startMs"], clip["endMs"], sample_rate)
        actual_ms = probe_duration_ms(target)
        if abs(actual_ms - expected_ms) > 50:
            raise RuntimeError(f"{clip['id']}: exported {actual_ms} ms, expected {expected_ms} ms.")
        return {
            "clip_id": clip["id"], "file": f"{folder}/{target.name}", "audio_variant": variant,
            "start_ms": clip["startMs"], "end_ms": clip["endMs"],
            "duration_s": f"{actual_ms / 1000:.3f}", "trimmed_ms": clip["durationMs"] - expected_ms,
            "sample_rate": sample_rate, "sha256": sha256_file(target),
            "transcript": (review.get("transcript") or "").strip(), "speaker_role": review.get("speakerRole") or "", "speaker": review.get("speaker") or "",
            "has_music": "" if review.get("hasMusic") is None else str(review["hasMusic"]).lower(),
            "tier": review["tier"], "source_file": src["fileName"], "source_sha256": src["sha256"],
            "source_url": src.get("sourceUrl") or "",
        }

    rows = [export(clip, source, "clips", "original") for clip in accepted]
    tts_rows = [export(clip, vocals, "tts_clips", variant_name, shorten_pauses=True) for clip in accepted if clip["review"]["tier"] == "asr_tts"]
    _write_csv(out / "metadata.csv", rows)
    _write_csv(out / "metadata_tts.csv", tts_rows)
    (out / "export.json").write_text(json.dumps({
        "schema": "sautiforge.segmentation.export/1", "sourceSha256": src["sha256"], "sampleRate": sample_rate,
        "clipCount": len(rows), "ttsCount": len(tts_rows), "maxPauseMs": max_pause_ms,
        "pausePolicy": "silences between speech are capped at maxPauseMs in the TTS copies only; ASR copies are unaltered",
        "processing": manifest["processing"],
    }, indent=2) + "\n", encoding="utf-8")
    return {"count": len(rows), "tts": len(tts_rows), "dir": out, "seconds": sum(float(r["duration_s"]) for r in rows)}


def _write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
