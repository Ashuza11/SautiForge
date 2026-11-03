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
# 1. Propose clips (the media file is only read)
.venv/bin/python -m sautiseg prepare --input ../../Data/<file>.mp4 --out ../../segmentation-output \
  --source-url https://www.jesusfilm.org/watch --has-music

# 2. Review: play each clip, adjust boundaries, write the transcript, accept or reject.
#    Edit manifest.json (the web review screen will do this) so each reviewed clip has
#    review.status = accepted|rejected, a transcript, and tier = asr | asr_tts.

# 3. Export accepted clips cut from the ORIGINAL media at 24 kHz mono, with SHA-256 hashes
.venv/bin/python -m sautiseg cut --manifest ../../segmentation-output/<name>/manifest.json --source ../../Data/<file>.mp4
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
| Never join across | 2.5 s of silence | Different utterances stay separate |
| Padding | 150 ms | Never extends into a neighbouring clip |

## Tiers

- `asr`: reviewed, correctly transcribed; background music is allowed.
- `asr_tts`: also confirmed free of music, one speaker; also written to `metadata_tts.csv`. A TTS-eligible clip must have `hasMusic = false`.

## Privacy

Source media, working audio, and outputs live under `Data/` and `segmentation-output/`, which are git-ignored together with all media file types and the `.venv`.
