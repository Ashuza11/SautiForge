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

- Volunteers hear the cleaned (music-removed) audio.
- The music-background copy of each clip stays in the dataset for ASR. One clip has one transcript and two audio variants (`audio_variant`). Hours are never counted twice, and both variants of a clip stay in the same train/dev/test split.
- Two independent transcriptions per clip.
- Raw submissions are append-only. The final transcript is a separate, versioned record. No majority vote.
- Differences are shared as copyable text. A read-only link for community votes is a possible later step.
- Rights are managed by the project owner outside the code.
- Vercel Hobby allows 12 functions, so the API is one catch-all function.

## Batches

| # | Batch | Delivers |
| --- | --- | --- |
| 1 | Plan | This document |
| 2 | Admin login | Password and signed session cookie; bearer token kept for CLI use |
| 3 | Vercel entry | App exported for Vercel, routing rules, deploy notes |
| 4 | Clips tables | Clips and their audio variants in Neon |
| 5 | Clips API | Signed S3 upload checked by size and hash |
| 6 | `publish` command | Uploads an `export/` folder, safe to re-run, dry-run mode |
| 7 | Local sandbox | Real API on PGlite and disk audio, for testing without the cloud |
| 7b | Admin Clips screen | List, play, withdraw |
| 8 | Task tables | Batches, contributors, submissions (append-only) |
| 9 | Batches | Create a batch, link and WhatsApp message |
| 10 | Volunteer API | Pseudonym, own tasks only, signed audio, submit or skip |
| 11 | Volunteer screen | Mobile-first player and text box, drafts, retry |
| 12 | Compare screen | Side-by-side transcripts with character differences |
| 13 | Share differences | Copy button for WhatsApp text |
| 14 | Final transcript | Approve or write a transcript, with a note |
| 15 | Export | Approved clips, hashes, hours without double counting, split guidance |

## Local sandbox

`npm run server:sandbox` starts the real API on `http://127.0.0.1:8787` with the real migrations and repositories on PGlite (a Postgres engine) and audio on disk behind signed, expiring links. It seeds the Mashi project and one source with local-only rights, and prints the admin password, the API token and the source id. Data is kept in `.local-data/` (git-ignored); add `-- --memory` for a throwaway database. It refuses to run when `NODE_ENV=production`.

It lets every later batch be run and tested in a browser without Neon, S3 or Vercel. It does not replace one real cloud run.

## Needed from the project owner

Neon `DATABASE_URL`, a private S3 bucket with keys, a Vercel project, an admin password, and the Jesus Film registered as a source in the Mashi project (needed from batch 4).
