"""Export accepted clips from the original media with hashes and metadata."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import wave

import numpy as np

from .audio import cut_clip, decode_mono_pcm, probe_duration_ms, run, sha256_file
from .manifest import load_manifest
from .pauses import assemble, intersect, keep_ranges, kept_ms, subtract
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

    original_cache: dict = {}

    def original_samples():
        # Decoded once, only when a clip with removed sections is cut from the original audio.
        if "samples" not in original_cache:
            original_cache["samples"] = decode_mono_pcm(source, 44100)
        return original_cache["samples"], 44100

    def export(clip, media: Path, folder: str, variant: str, *, tts_copy: bool = False) -> dict:
        review = clip["review"]
        target = out / folder / f"{stem}_{clip['id']}.wav"
        start, end = clip["startMs"], clip["endMs"]
        # Sections the reviewer removed apply to every copy. For the TTS copy, silences between speech are also capped.
        ranges = subtract(start, end, [(r["startMs"], r["endMs"]) for r in clip.get("removed", [])])
        if tts_copy and max_pause_ms > 0:
            ranges = intersect(ranges, keep_ranges(spans, start, end, max_pause_ms))
        expected_ms = kept_ms(ranges)
        if ranges == [(start, end)]:
            cut_clip(media, target, start, end, sample_rate)   # nothing removed: a plain cut of the untouched audio
        else:
            samples, rate = (vocals_samples, vocals_rate) if tts_copy else original_samples()
            temp = target.with_name(f".{target.stem}_full.wav")
            write_mono_wav(temp, assemble(samples, rate, ranges) / 32768.0, rate)
            run(["ffmpeg", "-y", "-v", "error", "-i", str(temp), "-ac", "1", "-ar", str(sample_rate), "-c:a", "pcm_s16le", str(target)])
            temp.unlink()
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
    tts_rows = [export(clip, vocals, "tts_clips", variant_name, tts_copy=True) for clip in accepted if clip["review"]["tier"] == "asr_tts"]
    _write_csv(out / "metadata.csv", rows)
    _write_csv(out / "metadata_tts.csv", tts_rows)
    (out / "export.json").write_text(json.dumps({
        "schema": "sautiforge.segmentation.export/1", "sourceSha256": src["sha256"], "sampleRate": sample_rate,
        "clipCount": len(rows), "ttsCount": len(tts_rows), "maxPauseMs": max_pause_ms,
        "pausePolicy": "sections the reviewer removed are cut from every copy; silences between speech are additionally capped at maxPauseMs in the TTS copies only",
        "processing": manifest["processing"],
    }, indent=2) + "\n", encoding="utf-8")
    return {"count": len(rows), "tts": len(tts_rows), "dir": out, "seconds": sum(float(r["duration_s"]) for r in rows)}


def _write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
