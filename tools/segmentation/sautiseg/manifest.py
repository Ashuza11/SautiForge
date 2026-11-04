"""The review manifest: the single hand-off file between the CLI and the review screen."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "sautiforge.segmentation/1"
REVIEW_STATUSES = {"proposed", "accepted", "rejected"}
TIERS = {"asr", "asr_tts"}  # asr_tts = also eligible for the clean TTS subset


def new_review() -> dict:
    return {"status": "proposed", "transcript": None, "speaker": None, "hasMusic": None,
            "tier": None, "rejectReason": None, "reviewedBy": None, "reviewedAt": None}


def build_clip_record(clip, metrics: dict) -> dict:
    return {
        "id": clip.id, "startMs": clip.start_ms, "endMs": clip.end_ms, "durationMs": clip.duration_ms,
        "speechStartMs": clip.speech_start_ms, "speechEndMs": clip.speech_end_ms,
        "spanCount": clip.span_count, "cutCandidatesMs": clip.cut_candidates_ms,
        "flags": clip.flags, "metrics": metrics, "review": new_review(),
    }


def build_manifest(*, source: dict, processing: dict, spans: list, clips: list[dict]) -> dict:
    return {
        "schema": SCHEMA,
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source, "processing": processing,
        "speechSpans": [{"startMs": s, "endMs": e} for s, e in spans],
        "clips": clips,
    }


def write_manifest(path: Path, manifest: dict) -> None:
    validate_manifest(manifest)
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_manifest(path: Path) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    validate_manifest(manifest)
    return manifest


def validate_manifest(manifest: dict) -> None:
    if manifest.get("schema") != SCHEMA:
        raise ValueError(f"Unsupported manifest schema: {manifest.get('schema')!r}")
    source = manifest.get("source") or {}
    for key in ("fileName", "sha256", "durationMs"):
        if key not in source:
            raise ValueError(f"Manifest source is missing {key}.")
    total = source["durationMs"]
    seen: set[str] = set()
    for clip in manifest.get("clips", []):
        cid = clip.get("id")
        if not cid or cid in seen:
            raise ValueError(f"Missing or duplicate clip id: {cid!r}")
        seen.add(cid)
        if not 0 <= clip["startMs"] < clip["endMs"] <= total:
            raise ValueError(f"{cid}: boundaries must satisfy 0 <= start < end <= source duration.")
        if clip["durationMs"] != clip["endMs"] - clip["startMs"]:
            raise ValueError(f"{cid}: durationMs does not match its boundaries.")
        review = clip.get("review") or {}
        if review.get("status") not in REVIEW_STATUSES:
            raise ValueError(f"{cid}: invalid review status.")
        if review["status"] == "accepted":
            if review.get("tier") not in TIERS:
                raise ValueError(f"{cid}: an accepted clip needs a tier ({sorted(TIERS)}).")
            if review.get("tier") == "asr_tts" and review.get("hasMusic") is not False:
                raise ValueError(f"{cid}: a TTS-eligible clip must be confirmed free of music.")
        if review["status"] == "rejected" and not review.get("rejectReason"):
            raise ValueError(f"{cid}: a rejected clip needs a reason.")
