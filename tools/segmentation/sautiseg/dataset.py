"""Build the dataset folder from the approved clips in the SautiForge service."""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from .audio import sha256_file
from .encode import decode_flac_to_wav, pcm_sha256
from .publish import UUID_RE, Http, _api, http_request

SCHEMA = "sautiforge.dataset/1"
COLUMNS = [
    "clip_id", "split", "audio_file", "music_audio_file", "transcript", "duration_s", "sample_rate",
    "sha256", "pcm_sha256", "flac_sha256", "derived_from", "transcribers", "final_version", "note",
]


def split_for(source_id: str, clip_key: str) -> str:
    """A fixed 80/10/10 split from the clip's name, so it never changes between exports.

    Both copies of a clip (clean and with music) are in one row and therefore always in the same split.
    """
    bucket = int(hashlib.sha256(f"{source_id}:{clip_key}".encode()).hexdigest()[:8], 16) % 100
    return "train" if bucket < 80 else "dev" if bucket < 90 else "test"


@dataclass
class MusicSource:
    """Where the music-background copies are, and what to expect of each (from `pack`)."""
    export_dir: Path
    original_rows: dict[str, dict]
    pack: dict[str, dict]


def load_music_source(export_dir: Path, pack_json: Path) -> MusicSource:
    rows = {}
    path = export_dir / "metadata.csv"
    if path.is_file():
        with path.open(newline="", encoding="utf-8") as handle:
            rows = {row["clip_id"]: row for row in csv.DictReader(handle) if row.get("audio_variant") == "original"}
    pack = {entry["clipKey"]: entry for entry in json.loads(pack_json.read_text(encoding="utf-8"))["clips"]}
    return MusicSource(export_dir.resolve(), rows, pack)


def _read_pack(pack_json: Path | None) -> dict[str, dict]:
    if not pack_json:
        return {}
    return {entry["clipKey"]: entry for entry in json.loads(pack_json.read_text(encoding="utf-8"))["clips"]}


def _download(http: Http, url: str) -> bytes:
    status, body = http("GET", url, {}, None)
    if status >= 300:
        raise RuntimeError(f"download failed with HTTP {status}")
    return body


def build_dataset(api_url: str, token: str, source_id: str, out_dir: Path, *, pack_json: Path | None = None,
                  export_dir: Path | None = None, overwrite: bool = False, dry_run: bool = False,
                  http: Http = http_request, log: Callable[[str], None] = print) -> dict:
    if not UUID_RE.match(source_id):
        raise ValueError("--source-id must be the source's UUID.")
    if export_dir and not pack_json:
        raise ValueError("--export needs --pack, so each music copy can be matched to its clip by key and times.")
    out_dir = out_dir.resolve()
    if (out_dir / "metadata.csv").exists() and not overwrite and not dry_run:
        raise RuntimeError(f"{out_dir / 'metadata.csv'} already exists. Use --overwrite to build it again.")

    base = api_url.rstrip("/")
    manifest = _api(http, base, token, "GET", f"/v1/admin/sources/{source_id}/export")
    clips = manifest["clips"]
    if not clips:
        raise RuntimeError("No clip is approved yet. Approve some final texts on the Results page first.")
    pack = _read_pack(pack_json)
    music = load_music_source(export_dir, pack_json) if export_dir and pack_json else None
    totals = manifest["totals"]
    log(f"{len(clips)} approved clips, {totals['durationMs'] / 1000 / 60:.1f} min of speech"
        f" ({totals['excluded']} left out, {totals['notExported']} not exported).")
    if dry_run:
        for clip in clips:
            log(f"  would build {clip['clipKey']}: {clip['durationMs'] / 1000:.2f}s, split {split_for(source_id, clip['clipKey'])}")
        return {"dryRun": True, "clips": len(clips), "failed": []}

    out_dir.mkdir(parents=True, exist_ok=True)
    wav_dir, music_dir = out_dir / "wavs", out_dir / "wavs_music"
    wav_dir.mkdir(exist_ok=True)
    rows, failed, music_count = [], [], 0
    with tempfile.TemporaryDirectory(prefix="sautiseg-dataset-") as scratch_name:
        scratch = Path(scratch_name)
        for index, clip in enumerate(clips, start=1):
            key = clip["clipKey"]
            try:
                flac_info = clip["flac"]
                data = _download(http, flac_info["url"])
                if len(data) != flac_info["sizeBytes"] or hashlib.sha256(data).hexdigest() != flac_info["sha256"]:
                    raise RuntimeError("the downloaded FLAC does not match its recorded size and hash")
                flac_path = scratch / f"{key}.flac"
                flac_path.write_bytes(data)
                wav_path = wav_dir / f"{key}.wav"
                decode_flac_to_wav(flac_path, wav_path)
                samples = pcm_sha256(wav_path)
                expected = flac_info.get("pcmSha256") or (pack.get(key) or {}).get("pcmSha256")
                if expected and samples != expected:
                    raise RuntimeError("the WAV does not have the same audio samples as the original recording")

                music_file = ""
                packed = pack.get(key)
                if music and packed and packed.get("derivedFrom") == "cleaned" and key in music.original_rows:
                    original = music.original_rows[key]
                    if int(original["start_ms"]) != packed["startMs"] or int(original["end_ms"]) != packed["endMs"]:
                        raise RuntimeError("the music copy has different start and end times than the clip")
                    source_file = (music.export_dir / original["file"]).resolve()
                    if music.export_dir not in source_file.parents or not source_file.is_file():
                        raise RuntimeError("the music copy file is missing")
                    if sha256_file(source_file) != original["sha256"]:
                        raise RuntimeError("the music copy does not match its recorded hash")
                    music_dir.mkdir(exist_ok=True)
                    shutil.copyfile(source_file, music_dir / f"{key}.wav")
                    music_file = f"wavs_music/{key}.wav"
                    music_count += 1

                rows.append({
                    "clip_id": key,
                    "split": split_for(source_id, key),
                    "audio_file": f"wavs/{key}.wav",
                    "music_audio_file": music_file,
                    "transcript": clip["transcript"],
                    "duration_s": f"{clip['durationMs'] / 1000:.3f}",
                    "sample_rate": clip["sampleRate"],
                    "sha256": sha256_file(wav_path),
                    "pcm_sha256": samples,
                    "flac_sha256": flac_info["sha256"],
                    "derived_from": clip["derivedFrom"],
                    "transcribers": clip["transcribers"],
                    "final_version": clip["finalVersion"],
                    "note": clip["note"],
                })
                log(f"[{index}/{len(clips)}] {key} ok{' (+ music copy)' if music_file else ''}")
            except (RuntimeError, OSError, KeyError, ValueError) as error:
                failed.append({"clip": key, "error": str(error)})
                (wav_dir / f"{key}.wav").unlink(missing_ok=True)
                log(f"[{index}/{len(clips)}] {key} FAILED: {error}")

    if failed:
        return {"dryRun": False, "clips": len(clips), "built": len(rows), "failed": failed, "dir": out_dir}

    _write_files(out_dir, manifest, rows, source_id, music_count)
    return {"dryRun": False, "clips": len(clips), "built": len(rows), "failed": [], "dir": out_dir, "musicCopies": music_count}


def _write_files(out_dir: Path, manifest: dict, rows: list[dict], source_id: str, music_count: int) -> None:
    rows.sort(key=lambda row: row["clip_id"])
    with (out_dir / "metadata.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    seconds = sum(float(row["duration_s"]) for row in rows)
    splits = {name: sum(1 for row in rows if row["split"] == name) for name in ("train", "dev", "test")}
    rights = manifest.get("rights") or {}
    shareable = bool((rights.get("authorizedUses") or {}).get("publicDistribution"))
    summary = {
        "schema": SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "project": manifest["project"],
        "source": manifest["source"],
        "rights": rights,
        "shareablePublicly": shareable,
        "totals": {
            "clips": len(rows),
            "hours": round(seconds / 3600, 4),
            "seconds": round(seconds, 3),
            "leftOut": manifest["totals"]["excluded"],
            "musicCopies": music_count,
            "splits": splits,
        },
        "hoursNote": "Each clip is counted once. Music-background copies are not added to the hours.",
        "splitRule": "80/10/10 by a hash of source id and clip key; both copies of a clip share one row and one split.",
        "audio": "16-bit mono WAV decoded from lossless FLAC; each file was checked against the recorded audio samples.",
    }
    (out_dir / "dataset.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    holder = rights.get("rightsHolder") or "not recorded"
    lines = [
        f"# {manifest['project']['title']}",
        "",
        f"Language: {manifest['project']['targetLanguage']} ({manifest['project']['languageCode']}), variety {manifest['project']['languageVariety']}.",
        f"Source: {manifest['source']['title']}" + (f" ({manifest['source']['originalUrl']})" if manifest["source"].get("originalUrl") else "") + ".",
        f"Clips: {len(rows)} · {seconds / 3600:.2f} hours · train {splits['train']} / dev {splits['dev']} / test {splits['test']}.",
        "",
        "## Permission",
        f"Rights holder as recorded: {holder}.",
        f"Statement: {rights.get('permissionEvidence') or 'not recorded'}",
        "",
        "**Cleared for public distribution: yes.**" if shareable else "**NOT cleared for public distribution. Keep this dataset private until permission allows sharing.**",
        "",
        "## Files",
        "- `wavs/` the audio of each clip, as WAV.",
        "- `wavs_music/` the copy with background music, where the source had music." if music_count else "- (no music-background copies were added)",
        "- `metadata.csv` one row per clip: transcript, split, hashes.",
        "- `dataset.json` the same facts in one file.",
        "",
        "Transcripts were written by volunteers from the community, each clip by two different people, and the final text was chosen or confirmed by the project administrator.",
    ]
    (out_dir / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
