"""Command line entry point: `python -m sautiseg prepare ...`."""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

from . import __version__
from .audio import (WORKING_SAMPLE_RATE, clip_metrics, extract_working_wav, ffmpeg_version,
                    probe_duration_ms, read_wav_int16, sha256_file)
from .clips import ClipParams, build_clips
from .manifest import build_clip_record, build_manifest, write_manifest
from .cutting import DEFAULT_MAX_PAUSE_MS, cut_accepted
from .pack import pack
from .publish import publish
from .separate import MODEL_NAME, ensure_separation
from .vad import VadParams, detect, speech_stats


INFO_FLAGS = {"tts_length_ok"}  # positive tags, not warnings


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", Path(name).stem.lower()).strip("-")[:60] or "source"


def cmd_prepare(args: argparse.Namespace) -> int:
    source = Path(args.input).resolve()
    if not source.is_file():
        print(f"Input not found: {source}", file=sys.stderr)
        return 2
    out = Path(args.out).resolve() / slug(source.name)
    out.mkdir(parents=True, exist_ok=True)

    vad = VadParams(threshold=args.threshold, min_speech_ms=args.min_speech_ms,
                    min_silence_ms=args.min_silence_ms, max_speech_s=args.hard_max_s)
    params = ClipParams(min_clip_ms=round(args.min_clip_s * 1000), min_preferred_ms=round(args.min_preferred_s * 1000),
                        target_max_ms=round(args.target_max_s * 1000), hard_max_ms=round(args.hard_max_s * 1000),
                        sentence_pause_ms=args.sentence_pause_ms, max_gap_ms=args.max_gap_ms, pad_ms=args.pad_ms)
    params.validate()

    print(f"[1/4] Hashing and probing {source.name}")
    sha, total_ms = sha256_file(source), probe_duration_ms(source)

    print("[2/4] Extracting 16 kHz mono working audio")
    working = out / "audio_16k.wav"
    extract_working_wav(source, working)
    samples, rate = read_wav_int16(working)

    separation = None
    detect_samples = samples
    if args.separate:
        print("[2b/4] Removing background music (vocal separation)")
        separation = ensure_separation(source, sha, out, model_name=args.separation_model)
        detect_samples, _ = read_wav_int16(out / separation["vocals16"])

    print(f"[3/4] Detecting speech with Silero VAD{' on the separated vocals' if separation else ''}")
    spans, probs = detect(detect_samples, rate, vad)

    print("[4/4] Building clip proposals")
    clips = build_clips(spans, total_ms, params)
    records = []
    for clip in clips:
        metrics = clip_metrics(samples, rate, clip.start_ms, clip.end_ms)
        if separation:
            metrics["vocalsRmsDb"] = clip_metrics(detect_samples, rate, clip.start_ms, clip.end_ms)["rmsDb"]
        metrics.update(speech_stats(probs, clip.start_ms, clip.end_ms, vad.threshold))
        if metrics["clippedRatio"] > 0.001:
            clip.flags.append("clipping")
        if metrics["speechRatio"] < 0.5 and not separation:
            clip.flags.append("low_speech_ratio")  # often music or noise held open as speech
        records.append(build_clip_record(clip, metrics))

    manifest = build_manifest(
        source={"fileName": source.name, "sha256": sha, "sizeBytes": source.stat().st_size,
                "durationMs": total_ms, "sourceUrl": args.source_url, "notes": args.notes,
                "hasBackgroundMusic": args.has_music, "workingAudio": working.name,
                "workingSampleRate": WORKING_SAMPLE_RATE,
                **({"vocalsAudio": separation["vocals16"], "vocals44Audio": separation["vocals44"],
                    "vocals44Sha256": separation["vocals44Sha256"]} if separation else {})},
        processing={"tool": "sautiseg", "toolVersion": __version__, "ffmpeg": ffmpeg_version(),
                    "vad": {"model": "silero-vad", "audio": "vocals" if separation else "original", **vad.as_dict()},
                    "clips": params.__dict__,
                    **({"separation": {k: separation[k] for k in ("model", "device", "overlap", "seconds")}} if separation else {})},
        spans=spans, clips=records)
    write_manifest(out / "manifest.json", manifest)

    flagged = sum(1 for r in records if set(r["flags"]) - INFO_FLAGS)
    total_clip_s = sum(r["durationMs"] for r in records) / 1000
    print(f"\n{len(spans)} speech spans -> {len(records)} proposed clips ({total_clip_s:.1f} s), {flagged} need attention")
    print(f"Wrote {out / 'manifest.json'}\nNext: open the review screen, then run `cut`.")
    return 0


def cmd_cut(args: argparse.Namespace) -> int:
    result = cut_accepted(Path(args.manifest), Path(args.source), sample_rate=args.sample_rate, max_pause_ms=args.max_pause_ms)
    print(f"Exported {result['count']} clips ({result['seconds']:.1f} s) -> {result['dir']}")
    print(f"ASR-ready: {result['count']}, TTS-eligible: {result['tts']}")
    return 0


def cmd_publish(args: argparse.Namespace) -> int:
    token = os.environ.get(args.token_env, "")
    if not args.dry_run and len(token) < 32:
        print(f"Set {args.token_env} to the service's admin API token (kept out of the command line).", file=sys.stderr)
        return 2
    result = publish(Path(args.export), args.api, token, args.source_id, args.created_by, dry_run=args.dry_run)
    if result["failed"]:
        print(f"{len(result['failed'])} clip(s) failed. Fix the cause and run the same command again; finished clips are skipped.", file=sys.stderr)
        return 1
    if not result["dryRun"]:
        print(f"Done: {result['published']} of {result['clips']} clips are published.")
    return 0


def cmd_pack(args: argparse.Namespace) -> int:
    only = [key for key in (args.only or "").split(",") if key.strip()] or None
    result = pack(Path(args.export), Path(args.out) if args.out else None, only=only, first=args.first)
    print(f"Packed {result['count']} clips ({result['bytes'] // 1024} KB) into {result['dir']}")
    print("Upload the .flac files on the Upload page of the admin site. Keep pack.json: it links each clip back to its WAV.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sautiseg", description="Propose, review and export speech clips.")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("prepare", help="Detect speech and write a review manifest.")
    p.add_argument("--input", required=True, help="Local video or audio file (never modified).")
    p.add_argument("--out", default="segmentation-output", help="Output root directory (git-ignored).")
    p.add_argument("--source-url", default=None, help="Where the source is published.")
    p.add_argument("--notes", default=None)
    p.add_argument("--has-music", action="store_true", help="Record that the source contains background music.")
    p.add_argument("--separate", action="store_true", help="Remove background music first (Demucs vocals) and detect speech on the cleaned voice.")
    p.add_argument("--separation-model", default=MODEL_NAME)
    p.add_argument("--threshold", type=float, default=0.5, help="VAD speech probability threshold.")
    p.add_argument("--min-speech-ms", type=int, default=250)
    p.add_argument("--min-silence-ms", type=int, default=300)
    p.add_argument("--min-clip-s", type=float, default=1.5)
    p.add_argument("--min-preferred-s", type=float, default=3.0)
    p.add_argument("--target-max-s", type=float, default=12.0)
    p.add_argument("--hard-max-s", type=float, default=20.0)
    p.add_argument("--sentence-pause-ms", type=int, default=700)
    p.add_argument("--max-gap-ms", type=int, default=1000)
    p.add_argument("--pad-ms", type=int, default=150)
    p.set_defaults(func=cmd_prepare)

    c = sub.add_parser("cut", help="Export reviewed (accepted) clips with hashes and metadata.")
    c.add_argument("--manifest", required=True, help="Reviewed manifest.json.")
    c.add_argument("--source", required=True, help="The original media file the manifest was made from.")
    c.add_argument("--sample-rate", type=int, default=24000, help="Output rate; clips are cut from the original, not the 16 kHz copy.")
    c.add_argument("--max-pause-ms", type=int, default=DEFAULT_MAX_PAUSE_MS, help="Cap silences between speech in the TTS copies (0 disables). ASR copies are never changed.")
    c.set_defaults(func=cmd_cut)

    k = sub.add_parser("pack", help="Convert an export folder to FLAC files you can upload on the admin site.")
    k.add_argument("--export", required=True, help="The export/ folder written by `cut`.")
    k.add_argument("--out", default=None, help="Where to write the FLAC files (default: an upload/ folder next to export/).")
    k.add_argument("--only", default=None, help="Comma-separated clip keys to pack, for example c001,c002,c003.")
    k.add_argument("--first", type=int, default=None, help="Pack only the first N clips (handy for a small test).")
    k.set_defaults(func=cmd_pack)

    u = sub.add_parser("publish", help="Upload an export folder to the SautiForge service (safe to run again).")
    u.add_argument("--export", required=True, help="The export/ folder written by `cut`.")
    u.add_argument("--api", required=True, help="Service base URL, for example https://your-site.vercel.app")
    u.add_argument("--source-id", required=True, help="UUID of the registered source in the Mashi project.")
    u.add_argument("--created-by", default="ADMIN-01", help="Pseudonymous administrator code.")
    u.add_argument("--token-env", default="SAUTIFORGE_ADMIN_TOKEN", help="Environment variable holding the admin API token.")
    u.add_argument("--dry-run", action="store_true", help="Verify hashes and list what would be published; upload nothing.")
    u.set_defaults(func=cmd_publish)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (RuntimeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
