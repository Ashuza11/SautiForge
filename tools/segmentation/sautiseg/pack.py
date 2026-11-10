"""Turn an export folder into a folder of FLAC files ready to upload in the SautiForge admin page."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

from .audio import sha256_file
from .encode import encode_flac, verify_flac_round_trip
from .publish import load_export

PACK_SCHEMA = "sautiforge.upload-pack/1"


def pack(export_dir: Path, out_dir: Path | None = None, only: list[str] | None = None, first: int | None = None,
         log: Callable[[str], None] = print) -> dict:
    """Write `<clip key>.flac` for each clip plus `pack.json`.

    One file per clip: the cleaned (music-removed) copy when the export has one, otherwise the original.
    Every FLAC is decoded again and must give exactly the same audio samples as its WAV, so converting
    back to WAV later gives the same audio. The WAV files stay where they are.
    """
    export_dir = export_dir.resolve()
    out_dir = (out_dir or export_dir.parent / "upload").resolve()
    clips, _segmenter = load_export(export_dir)
    if only:
        wanted = [key.strip() for key in only if key.strip()]
        missing = sorted(set(wanted) - {clip.clip_key for clip in clips})
        if missing:
            raise RuntimeError(f"These clips are not in the export: {', '.join(missing)}.")
        clips = [clip for clip in clips if clip.clip_key in wanted]
    if first is not None:
        clips = clips[:first]
    if not clips:
        raise RuntimeError("There are no clips to pack.")

    out_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    total = 0
    for index, clip in enumerate(clips, start=1):
        target = out_dir / f"{clip.clip_key}.flac"
        encode_flac(clip.wav_path, target)
        pcm_sha = verify_flac_round_trip(clip.wav_path, target)
        size = target.stat().st_size
        total += size
        entries.append({
            "clipKey": clip.clip_key,
            "file": target.name,
            "flacSha256": sha256_file(target),
            "pcmSha256": pcm_sha,
            "sizeBytes": size,
            "sampleRate": clip.sample_rate,
            "durationMs": clip.duration_ms,
            "derivedFrom": clip.derived_from,
            "wavFile": str(clip.wav_path.relative_to(export_dir)),
            "wavSha256": sha256_file(clip.wav_path),
            "speakerRole": clip.speaker_role,
            "speakerName": clip.speaker_name,
            "hasMusic": clip.has_music,
            "startMs": clip.start_ms,
            "endMs": clip.end_ms,
        })
        log(f"[{index}/{len(clips)}] {clip.clip_key}: {size // 1024} KB ({clip.derived_from})")
    (out_dir / "pack.json").write_text(json.dumps({"schema": PACK_SCHEMA, "exportDir": str(export_dir), "clips": entries}, indent=2) + "\n", encoding="utf-8")
    return {"count": len(entries), "dir": out_dir, "bytes": total}
