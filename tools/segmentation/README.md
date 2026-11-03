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

- `asr`: reviewed, correctly transcribed; background music is allowed.
- `asr_tts`: also confirmed free of music on the cleaned voice, one speaker. It is cut from the separated vocals into `tts_clips/` and listed in `metadata_tts.csv` with `audio_variant = vocals_<model>`. A TTS-eligible clip must have `hasMusic = false`.

Separated audio is processed audio, not an original recording: say so when reporting the dataset. Cleaned vocals contain digital silence where music-only passages were, so clips never join speech across more than 1 s of silence (`--max-gap-ms`), and a clip with a longer internal silence is flagged `long_internal_pause`.

## Privacy

Source media, working audio, and outputs live under `Data/` and `segmentation-output/`, which are git-ignored together with all media file types and the `.venv`.

## Review screen (web app, local only)

Nothing is uploaded; the two files are read in the browser and progress is saved to browser storage after every change (each save is read back to confirm it). Per clip you can play and loop it, click the waveform to place a marker, nudge either edge, split at a detected pause or at the marker, merge with the next clip, write the verbatim transcript, record speaker and music, choose the tier, then accept or reject (with a reason). Splitting, merging or moving an edge sends the clip back to review. The downloaded manifest is validated by the same rules `cut` enforces.
