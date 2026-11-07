"""Publish an exported clip folder to the SautiForge service (S3 audio, Neon records)."""

from __future__ import annotations

import csv
import json
import re
import urllib.error
import urllib.request
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .audio import sha256_file

CLEANED = "vocals_htdemucs"
ORIGINAL = "original"
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
ADMIN_CODE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]+$")


@dataclass
class AudioFile:
    variant: str
    path: Path
    size_bytes: int
    sha256: str
    sample_rate: int
    duration_ms: int


@dataclass
class PublishClip:
    clip_key: str
    start_ms: int
    end_ms: int
    trimmed_ms: int
    duration_ms: int
    speaker_role: str
    speaker_name: str | None
    has_music: bool
    tier: str
    audio: list[AudioFile]

    def draft(self, created_by: str, segmenter: str | None) -> dict:
        return {
            "clipKey": self.clip_key,
            "startMs": self.start_ms,
            "endMs": self.end_ms,
            "trimmedMs": self.trimmed_ms,
            "durationMs": self.duration_ms,
            "speakerRole": self.speaker_role,
            "speakerName": self.speaker_name,
            "hasMusic": self.has_music,
            "tier": self.tier,
            "segmenter": segmenter,
            "createdBy": created_by,
            "audio": [{"variant": a.variant, "sizeBytes": a.size_bytes, "sha256": a.sha256,
                       "sampleRate": a.sample_rate, "durationMs": a.duration_ms} for a in self.audio],
        }


def wav_info(path: Path) -> tuple[int, int]:
    with wave.open(str(path), "rb") as handle:
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2:
            raise RuntimeError(f"{path.name}: expected 16-bit mono WAV.")
        rate = handle.getframerate()
        return rate, round(handle.getnframes() * 1000 / rate)


def _read_rows(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def load_export(export_dir: Path) -> tuple[list[PublishClip], str | None]:
    """Read and verify an export folder. Raises RuntimeError on any mismatch."""
    export_dir = export_dir.resolve()
    cleaned_rows = _read_rows(export_dir / "metadata_tts.csv")
    original_rows = _read_rows(export_dir / "metadata.csv")
    if not cleaned_rows:
        raise RuntimeError("metadata_tts.csv (the cleaned audio) is missing or empty. Volunteers hear the cleaned copy.")
    by_variant = {CLEANED: {r["clip_id"]: r for r in cleaned_rows}, ORIGINAL: {r["clip_id"]: r for r in original_rows}}
    for variant, rows in by_variant.items():
        for row in rows.values():
            if row["audio_variant"] != variant:
                raise RuntimeError(f"{row['clip_id']}: expected audio_variant {variant}, found {row['audio_variant']}.")

    metadata_path = export_dir / "export.json"
    segmenter = None
    if metadata_path.is_file():
        tool = json.loads(metadata_path.read_text(encoding="utf-8")).get("processing", {})
        if tool.get("tool") and tool.get("toolVersion"):
            segmenter = f"{tool['tool']} {tool['toolVersion']}"

    clips: list[PublishClip] = []
    for clip_id, cleaned in by_variant[CLEANED].items():
        audio: list[AudioFile] = []
        for variant, row in ((ORIGINAL, by_variant[ORIGINAL].get(clip_id)), (CLEANED, cleaned)):
            if row is None:
                continue
            path = (export_dir / row["file"]).resolve()
            if export_dir not in path.parents or not path.is_file():
                raise RuntimeError(f"{clip_id}: audio file {row['file']} is missing or outside the export folder.")
            sha = sha256_file(path)
            if sha != row["sha256"]:
                raise RuntimeError(f"{clip_id}: {row['file']} does not match the hash in the CSV. Re-export before publishing.")
            rate, duration = wav_info(path)
            audio.append(AudioFile(variant, path, path.stat().st_size, sha, rate, duration))
        if len(audio) == 2:
            for key in ("start_ms", "end_ms", "speaker_role", "speaker", "has_music", "tier"):
                if by_variant[ORIGINAL][clip_id][key] != cleaned[key]:
                    raise RuntimeError(f"{clip_id}: the two audio copies disagree on {key}.")
        has_music = cleaned["has_music"].strip().lower() == "true"
        clips.append(PublishClip(
            clip_key=clip_id,
            start_ms=int(cleaned["start_ms"]),
            end_ms=int(cleaned["end_ms"]),
            trimmed_ms=int(cleaned["trimmed_ms"] or 0),
            duration_ms=max(a.duration_ms for a in audio),
            speaker_role=cleaned["speaker_role"] or "unknown",
            speaker_name=cleaned["speaker"].strip() or None,
            has_music=has_music,
            tier=cleaned["tier"],
            audio=audio,
        ))
    orphans = set(by_variant[ORIGINAL]) - set(by_variant[CLEANED])
    if orphans:
        raise RuntimeError(f"Original copies without a cleaned copy: {', '.join(sorted(orphans))}.")
    return clips, segmenter


Http = Callable[[str, str, dict[str, str], bytes | None], tuple[int, bytes]]


def http_request(method: str, url: str, headers: dict[str, str], body: bytes | None) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except urllib.error.URLError as error:
        raise RuntimeError(f"Could not reach {url.split('?')[0]}: {error.reason}") from error


def _api(http: Http, base: str, token: str, method: str, path: str, payload: dict | None = None) -> dict:
    body = None if payload is None else json.dumps(payload).encode()
    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    status, data = http(method, f"{base}{path}", headers, body)
    try:
        parsed = json.loads(data or b"{}")
    except ValueError:
        parsed = {}
    if status >= 400:
        detail = parsed.get("message") or parsed.get("error") or f"HTTP {status}"
        raise RuntimeError(f"{method} {path} failed: {detail}")
    return parsed


def publish(export_dir: Path, api_url: str, token: str, source_id: str, created_by: str,
            dry_run: bool = False, http: Http = http_request, log: Callable[[str], None] = print) -> dict:
    if not UUID_RE.match(source_id):
        raise ValueError("--source-id must be the source's UUID from the SautiForge service.")
    if not ADMIN_CODE_RE.match(created_by):
        raise ValueError("--created-by must be a pseudonymous code such as ADMIN-01.")
    base = api_url.rstrip("/")
    clips, segmenter = load_export(export_dir)
    log(f"Verified {len(clips)} clips ({sum(len(c.audio) for c in clips)} audio files) against their hashes.")
    if dry_run:
        for clip in clips:
            log(f"  would publish {clip.clip_key}: {clip.duration_ms / 1000:.2f}s, {clip.speaker_role}, {len(clip.audio)} audio files")
        return {"dryRun": True, "clips": len(clips), "published": 0, "failed": []}

    published, failed = 0, []
    for index, clip in enumerate(clips, start=1):
        try:
            registered = _api(http, base, token, "POST", f"/v1/admin/sources/{source_id}/clips", clip.draft(created_by, segmenter))
            by_variant = {a.variant: a for a in clip.audio}
            for item in registered["files"]:
                upload = item.get("upload")
                if not upload:
                    continue
                audio = by_variant[item["file"]["variant"]]
                status, body = http("PUT", upload["url"], dict(upload["headers"]), audio.path.read_bytes())
                if status >= 300:
                    raise RuntimeError(f"upload of {audio.variant} failed with HTTP {status}")
            done = _api(http, base, token, "POST", f"/v1/admin/clips/{registered['clip']['id']}/complete")
            if done["clip"]["status"] != "published":
                raise RuntimeError(f"clip ended as {done['clip']['status']}")
            published += 1
            log(f"[{index}/{len(clips)}] {clip.clip_key} published")
        except RuntimeError as error:
            failed.append({"clip": clip.clip_key, "error": str(error)})
            log(f"[{index}/{len(clips)}] {clip.clip_key} FAILED: {error}")
    return {"dryRun": False, "clips": len(clips), "published": published, "failed": failed}
