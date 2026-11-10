# Community transcription plan (Mashi pilot)

Decided 2026-11-07. Builds on `COMMUNITY_V2_ARCHITECTURE.md` and `SERVER_FOUNDATION.md`.

## Workflow

1. The admin reviews and cuts clips with the segmentation tool (`tools/segmentation`, web review screen).
2. `publish` uploads the exported clips: audio to private S3, metadata to Neon.
3. The admin creates a batch of 5–10 clips, gets a link and a copyable WhatsApp message, and posts it manually in the Mashi community.
4. A volunteer opens the link on a phone, picks a pseudonym (no account) and sees one clip at a time: play, pause, replay, slow down, a text box, submit, skip, next.
5. Each clip gets two independent transcriptions. A volunteer never sees another person's text.
6. The admin compares the transcriptions (character-level differences), copies a WhatsApp-ready summary, shares it for discussion, and records the final transcript.
7. Approved clips are exported with hashes.

Everything is online: Neon for records, private S3 for audio, Vercel for the site and API. There is no CSV download or upload for volunteers and no "wrong language" option.

## Decisions

- One audio file is stored online per clip: the cleaned (music-removed) copy when the video had music, otherwise the original. Volunteers hear that audio. The music-background copy stays on the admin's machine for ASR and is joined to the clip by clip key and hash when the dataset is exported. Hours are never counted twice, and both copies of a clip stay in the same train/dev/test split.
- Redesign decision (2026-11-10): each clip is stored as ONE FLAC file, and volunteers play that same file (every current browser, including Safari, plays FLAC). The local `pack` command converts the cut, cleaned clips to FLAC and checks that each FLAC decodes back to exactly the same audio samples as its WAV. The admin uploads the FLAC files in the browser. The final dataset converts FLAC back to WAV. The separate Opus listening copy from batch 7c is no longer needed for browser uploads. A WAV file's own hash is not used because WAV headers differ between tool versions.
- Clips are cut and cleaned in the local pipeline (`tools/segmentation`). Cutting in the browser is a possible much later step.
- Audio lives in Neon Object Storage (S3-compatible, Frankfurt, private bucket). Neon accepts the checksum and encryption headers but does not report encryption back, so the encryption check is skipped for Neon endpoints only; size, media type and SHA-256 are still verified.
- Measured on the 53 real clips: about 99 MB per hour of speech for both stored copies (10 hours is about 1 GB, 15 hours about 1.5 GB), well inside the 5 GB free allowance.
- Two independent transcriptions per clip.
- Raw submissions are append-only. The final transcript is a separate, versioned record. No majority vote.
- Differences are shared as copyable text. A read-only link for community votes is a possible later step.
- Rights are managed by the project owner outside the code.
- Vercel Hobby allows 12 functions, so the API is one catch-all function.

## Simplified flow (redesign, 2026-11-10)

The admin sees three things and nothing else: **Upload · Batches · Results**.

1. First visit: type a project name and pick the language (two fields). Then say where the audio comes from (a title and an optional link) and tick one box: "I have permission to use these recordings for transcription". The tick records the admin's own statement.
2. Upload: drag in the FLAC files made by `pack`, see them as a list.
3. Batches: choose 5 clips, press **Create batch**, copy the link and the ready WhatsApp message.
4. Volunteer page (a phone link, no account): one clip at a time, play, slower, a text box, submit or skip.
5. Results: per batch, how many clips are done; per clip, the transcripts side by side; pick the final text; export.

## Batches

| # | Batch | Delivers | State |
| --- | --- | --- | --- |
| 1-7b | Plan, admin login, Vercel entry, clips tables and API, `publish`, local sandbox, Clips screen | Foundation | done |
| 7c-7e | Neon storage, projects on the server, Sources screen | Working cloud setup | done |
| A | `pack` command | FLAC files for upload with verified round trip | done |
| B | Upload API and FLAC-only clips | One FLAC per clip, uploaded from the browser (`POST /v1/admin/sources/:id/clips/upload`, max 4 MB per file) | done |
| C | New admin shell and first-run setup | Upload / Batches / Results; two-field project; one-tick source. Older tools stay at `#tools` | done |
| D | Upload page | Drag in FLAC files, list, play, remove | done |
| E | Batches | Pick 5 clips, signed link (`/#/b/<batch id>.<code>`), editable WhatsApp message, close | done |
| F | Volunteer API and screen | Nickname, no account; one clip at a time; two independent transcripts per clip; append-only submissions; drafts and retry on the phone | done |
| G | Results and progress | Per-batch progress, transcripts side by side, character differences, copyable WhatsApp text (versions A/B, no nicknames) | done |
| H | Final transcript and export (next) | Approve text, hashes, FLAC converted back to WAV, hours without double counting | |

## Local sandbox

`npm run server:sandbox` starts the real API on `http://127.0.0.1:8787` with the real migrations and repositories on PGlite (a Postgres engine) and audio on disk behind signed, expiring links. It seeds the Mashi project and one source with local-only rights, and prints the admin password, the API token and the source id. Data is kept in `.local-data/` (git-ignored); add `-- --memory` for a throwaway database. It refuses to run when `NODE_ENV=production`.

It lets every later batch be run and tested in a browser without Neon, S3 or Vercel. It does not replace one real cloud run.

## Needed from the project owner

Neon `DATABASE_URL`, a private S3 bucket with keys, a Vercel project, an admin password, and the Jesus Film registered as a source in the Mashi project (needed from batch 4).
