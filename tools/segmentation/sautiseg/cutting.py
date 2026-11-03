"""Export accepted clips from the original media with hashes and metadata."""

from __future__ import annotations

import csv
import json
from pathlib import Path

from .audio import cut_clip, probe_duration_ms, sha256_file
from .manifest import load_manifest

COLUMNS = ["clip_id", "file", "start_ms", "end_ms", "duration_s", "sample_rate", "sha256", "transcript",
           "speaker", "has_music", "tier", "source_file", "source_sha256", "source_url"]


def cut_accepted(manifest_path: Path, source: Path, *, sample_rate: int = 24000) -> dict:
    manifest = load_manifest(manifest_path)
    src = manifest["source"]
    if sha256_file(source) != src["sha256"]:
        raise ValueError("Source file does not match the manifest SHA-256; refusing to cut the wrong media.")
    accepted = [c for c in manifest["clips"] if c["review"]["status"] == "accepted"]
    if not accepted:
        raise ValueError("No accepted clips in the manifest. Review and accept clips first.")

    stem = manifest_path.parent.name
    out = manifest_path.parent / "export"
    clips_dir = out / "clips"
    rows = []
    for clip in accepted:
        review = clip["review"]
        target = clips_dir / f"{stem}_{clip['id']}.wav"
        cut_clip(source, target, clip["startMs"], clip["endMs"], sample_rate)
        actual_ms = probe_duration_ms(target)
        if abs(actual_ms - clip["durationMs"]) > 50:
            raise RuntimeError(f"{clip['id']}: exported {actual_ms} ms, expected {clip['durationMs']} ms.")
        rows.append({
            "clip_id": clip["id"], "file": f"clips/{target.name}", "start_ms": clip["startMs"], "end_ms": clip["endMs"],
            "duration_s": f"{actual_ms / 1000:.3f}", "sample_rate": sample_rate, "sha256": sha256_file(target),
            "transcript": review["transcript"].strip(), "speaker": review.get("speaker") or "",
            "has_music": "" if review.get("hasMusic") is None else str(review["hasMusic"]).lower(),
            "tier": review["tier"], "source_file": src["fileName"], "source_sha256": src["sha256"],
            "source_url": src.get("sourceUrl") or "",
        })

    _write_csv(out / "metadata.csv", rows)
    tts_rows = [r for r in rows if r["tier"] == "asr_tts"]
    _write_csv(out / "metadata_tts.csv", tts_rows)
    (out / "export.json").write_text(json.dumps({
        "schema": "sautiforge.segmentation.export/1", "sourceSha256": src["sha256"], "sampleRate": sample_rate,
        "clipCount": len(rows), "ttsCount": len(tts_rows), "processing": manifest["processing"],
    }, indent=2) + "\n", encoding="utf-8")
    return {"count": len(rows), "tts": len(tts_rows), "dir": out, "seconds": sum(float(r["duration_s"]) for r in rows)}


def _write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
