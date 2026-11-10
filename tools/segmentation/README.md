# sautiseg: speech clip segmentation

Turns a long, permission-cleared video or audio file into reviewable speech clips for ASR and TTS datasets. Silero VAD **proposes** boundaries; a human reviews and fixes them. Boundaries are only placed in pauses, never inside a phrase.

```text
media file -> prepare (ffmpeg + Silero VAD) -> manifest.json -> human review -> cut -> clips + metadata.csv
```

## Setup (once)

```bash
cd tools/segmentation
python3 -m venv --system-site-packages .venv    # reuses an installed PyTorch
.venv/bin/pip install -r requirements.txt
```

Requires `ffmpeg` and `ffprobe` on the PATH. CPU only; a 7-minute video takes about 30 s.

## Use

```bash
# 1. Propose clips (the media file is only read). --separate removes background music first
#    (Demucs vocals, about 1.4x real time on CPU, cached for re-runs) and detects speech on the cleaned voice.
.venv/bin/python -m sautiseg prepare --input ../../Data/<file>.mp4 --out ../../segmentation-output \
  --source-url https://www.jesusfilm.org/watch --has-music --separate

# 2. Review in the web app: run `npm run web:dev`, open Segmentation, choose manifest.json and
#    audio_16k.wav from the output folder, review every clip, then Download reviewed manifest.
#    Save it as manifest.reviewed.json in the same output folder.

# 3. Export accepted clips at 24 kHz mono with SHA-256 hashes: all clips from the ORIGINAL media (clips/),
#    TTS-tier clips also from the cleaned voice (tts_clips/)
.venv/bin/python -m sautiseg cut --manifest ../../segmentation-output/<name>/manifest.reviewed.json --source ../../Data/<file>.mp4
```

Tests: `.venv/bin/python -m unittest discover -s tests -t .`

## Clip rules (defaults, all configurable)

| Rule | Default | Why |
| --- | --- | --- |
| Minimum clip | 1.5 s | Shorter clips are flagged `too_short`, never silently dropped |
| Preferred minimum before closing at a pause | 3 s | Avoids fragments |
| Target maximum | 12 s | TTS-friendly; longer is flagged `over_target` |
| Hard maximum | 20 s | Longer is flagged `needs_manual_split` |
| Sentence pause | 700 ms | A pause this long can end a clip |
| Never join across | 1 s of silence | Different utterances stay separate; no dead air inside TTS clips |
| Padding | 150 ms | Never extends into a neighbouring clip |

## Tiers

- `asr`: every accepted clip. Cut from the original audio; background music is allowed. A transcript is optional, since community annotators can transcribe later.
- `asr_tts`: also confirmed free of music on the cleaned voice, one speaker. It is cut from the separated vocals into `tts_clips/` and listed in `metadata_tts.csv` with `audio_variant = vocals_<model>`. A TTS-eligible clip must have `hasMusic = false`.

Each clip can carry a speaker role (`narrator`, `character`, `multiple`, `unknown`) plus a free-text name or code such as `Jesus` or `voice A`. They export as the `speaker_role` and `speaker` columns, so a TTS set can be filtered to a single narrator. Both can be changed after a clip is accepted.

Separated audio is processed audio, not an original recording: say so when reporting the dataset. Cleaned vocals contain digital silence where music-only passages were, so clips never join speech across more than 1 s of silence (`--max-gap-ms`), and a clip with a longer internal silence is flagged `long_internal_pause`. At export, silences between speech in the **TTS copies only** are capped at `--max-pause-ms` (default 500; 0 disables) and the removed time is recorded in `trimmed_ms`. ASR copies are never altered. In the review screen, "Split and drop" cuts a clip inside a silence and leaves the silence out of both parts.

**Removing white space inside a clip.** Drag across the clip waveform to select any stretch and click "Remove selection", or click "Shorten to 0.3 s" on a detected silence. The removed sections are stored on the clip (`removed`), skipped when you play it, and cut out of **every** exported copy (ASR and TTS); the pieces are joined with a 5 ms fade, `trimmed_ms` records the total, and your source and vocals files are never edited. They can be restored one by one or undone. A removal sends the clip back to review.

## Privacy

Source media, working audio, and outputs live under `Data/` and `segmentation-output/`, which are git-ignored together with all media file types and the `.venv`.

## Review screen (web app, local only)

Nothing is uploaded; the two files are read in the browser and progress is saved to browser storage after every change (each save is read back to confirm it). Per clip you can play and loop it, click the waveform to place a marker, nudge either edge or trim it straight to the marker, split at a detected pause or at the marker, merge with the next clip, write the verbatim transcript, record speaker and music, choose the tier, then accept or reject (with a reason). Every change can be undone and redone (buttons or Ctrl+Z / Ctrl+Shift+Z) until the page is reloaded; the saved review itself survives a reload. Splitting, merging or moving an edge sends the clip back to review. The downloaded manifest is validated by the same rules `cut` enforces.

## Pack clips as FLAC for upload

After `cut`, make the files you will upload on the admin site's Upload page:

```bash
python -m sautiseg pack --export segmentation-output/<name>/export --first 10      # a small test
python -m sautiseg pack --export segmentation-output/<name>/export --only c001,c002,c003
python -m sautiseg pack --export segmentation-output/<name>/export                 # everything
```

- It writes `upload/<clip key>.flac` next to `export/`, plus `pack.json` (hashes and the link back to each WAV). Keep `pack.json`; the final dataset uses it to turn the FLAC back into the same WAV audio.
- One file per clip: the cleaned (music-removed) copy when the export has one, otherwise the original.
- Each FLAC is decoded again and must match the WAV's audio samples exactly, or the command stops.
- Your WAV files are never changed.

## Build the dataset from approved clips

After approving final texts on the admin site's Results page:

```bash
export SAUTIFORGE_ADMIN_TOKEN=...   # the service's ADMIN_API_TOKEN
python -m sautiseg export-dataset --api https://your-site.vercel.app --source-id <source UUID> --out dataset --dry-run
python -m sautiseg export-dataset --api https://your-site.vercel.app --source-id <source UUID> --out dataset \
  --pack segmentation-output/<name>/upload/pack.json --export segmentation-output/<name>/export
```

- Each approved FLAC is downloaded, checked against its recorded size and hash, and turned back into a 16-bit WAV. With `--pack`, the WAV must have exactly the same audio samples as the original recording, or the clip fails.
- `--export` (needs `--pack`) adds the music-background copy of each clip to `wavs_music/`, matched by clip key and start/end times and checked against its recorded hash.
- It writes `wavs/`, `metadata.csv` (transcript, split, hashes), `dataset.json` and a `README.md` that states whether public sharing is permitted. Hours count each clip once; music copies are not added. The split is 80/10/10 from a hash of the source id and clip key, so it never changes between exports.
- If any clip fails, no dataset files are finished. Fix the cause and run it again (`--overwrite` replaces an existing build).

## Publish to the SautiForge service

After `cut`, upload the `export/` folder so the audio goes to private S3 and the clip records to Neon:

```bash
export SAUTIFORGE_ADMIN_TOKEN=...   # the service's ADMIN_API_TOKEN; never put it on the command line
python -m sautiseg publish --export segmentation-output/<name>/export \
  --api https://your-site.vercel.app --source-id <source UUID> --dry-run   # check first
python -m sautiseg publish --export segmentation-output/<name>/export \
  --api https://your-site.vercel.app --source-id <source UUID>
```

- Every file is re-hashed against the CSV first; a changed file stops the run.
- One audio file is published per clip: the cleaned copy (`vocals_htdemucs`) when the export has one, otherwise the original. The other copy stays on your machine.
- Each clip is stored twice online: a lossless FLAC master (about 57% of the WAV) and a small Opus copy (about 24 kbps) that volunteers play. The FLAC is decoded again before upload and must give exactly the same audio samples as the WAV; the samples' SHA-256 is stored so the dataset export can repeat the check. This needs `ffmpeg` with the FLAC and Opus encoders; `--dry-run` encodes too, so it tests this.
- It is safe to run again: verified audio is not uploaded twice, and speaker or tier fixes are applied in place. Changed cut points or a changed master need a new clip key (withdraw the old clip first). A listening copy that was encoded differently on another machine is kept as stored.
- A failed clip is reported at the end and does not stop the others.
- The source must already be registered in the Mashi project with approved rights (internal processing, volunteer access and transcription).
