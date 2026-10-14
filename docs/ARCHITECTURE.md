# Architecture

## Shape

SautiForge is a single offline-first Expo application. Screens depend on repository interfaces; SQLite implementations live below those interfaces. This keeps presentation code independent from storage details and leaves room for a later opt-in synchronization adapter without building a backend now.

The repository also contains a separate static React/Vite web workspace for computer-assisted review and annotation. Its first slice reuses the mobile export schemas, validates a selected research ZIP entirely in the browser, and exposes audio and metadata without a server. It rejects administrative backups. It does not modify the Android database or the original ZIP.

The interface language is an app-level presentation preference stored in `app_settings`. The i18n provider exposes complete English, French, and Kiswahili dictionaries to navigation and shared controls. Changing it does not translate or mutate researcher-entered projects, prompts, metadata, transcripts, or annotations.

```text
Expo Router screens
        ↓
feature presentation components
        ↓
repository interfaces + Zod domain schemas
        ↓
expo-sqlite repositories / migrations + export service
        ↓
SQLite database + app document storage (verified audio)
```

Feature code is grouped under `src/features/<feature>`. Shared database setup lives under `src/core/database`, explicit domain utilities under `src/domain`, and reusable presentation primitives under `src/ui`.

## Data integrity rules

- UUIDs are internal identifiers; recordings also receive separate human-readable IDs.
- Timestamps are ISO 8601 UTC strings (`Z` is an explicit zero offset).
- SQLite foreign keys are enabled at every database open and WAL mode is selected at creation.
- Migrations use `PRAGMA user_version`; the app refuses to open a newer unsupported schema.
- User input is bound as query parameters and parsed at runtime with Zod.
- Projects and scenarios are archived rather than deleted.
- A recording stores a scenario version and prompt snapshot, not only a mutable scenario foreign key. Imported elicited recordings also preserve the exact example selected during review.
- Audio remains outside SQLite under document storage. A recording row is inserted only after the accepted file has been copied and verified readable.

## Recording save transaction

1. Record with `expo-audio` using its high-quality M4A/AAC configuration and a visible recording state. Unaccepted takes remain in cache.
2. Stop and expose playback from the temporary take.
3. On acceptance, generate a recording UUID and unique filename.
4. Copy into an ID-scoped project directory in app document storage while retaining the source take for retry.
5. Verify existence, readability, and non-zero file size; retain requested codec/container settings and actual duration/file size.
6. Insert the recording row linked to the authorizing consent revision and verify it can be read back.
7. Delete the temporary source only after both file and row verification pass. On failure, remove the incomplete destination and retain the source take for retry.
8. Report success only after verification.

External contributions use the same acceptance boundary. A scenario stores up to 25 unique examples. The researcher shares the full numbered set in bold with brief speaking guidance through Android's share sheet; participant, submission, scenario, and instruction fields remain inside SautiForge. The Android document picker can return multiple audio files, which enter an in-memory review queue. Each file must be played and explicitly matched to its eliciting example—SautiForge never infers this label from picker order. It verifies every provider file is readable and non-empty, hashes it for duplicate detection, decodes it for playback/duration, and only then allows the normal verified save. The original container is preserved; unavailable codec, sample-rate, and channel metadata remain null rather than being guessed. Capture source, transport, prompt exposure, exact elicitation example, import time, source MIME type, hash, and submission code are stored and exported. The provider filename is retained only in the restricted local/administrative record because filenames may contain private information.

If a researcher later discovers that an imported recording was matched to the wrong example, the detail screen only permits a replacement from the frozen example set in that recording's scenario snapshot. The update and an append-only correction record containing the old value, new value, reason, timestamp, and optional researcher code are committed and verified in one transaction. Research exports use the corrected current association; the restricted administrative database retains the audit history.

At database initialization, document-storage recordings are reconciled against SQLite. Referenced non-empty files are counted as verified; missing references are reported in Settings; zero-byte and unreferenced files are moved into app-private recovery storage rather than treated as successful recordings or silently deleted.

Background recording, automatic WhatsApp/chat access, automatic uploads, remote authentication, and AI transcription are out of scope for 0.1.

## Local web review boundary

```text
research dataset ZIP selected by researcher
        ↓
browser ZIP extraction + manifest/schema/hash verification
        ↓
in-memory recording index, audio object URLs, and transcript view
```

There are no analytics, external scripts, accounts, network writes, or server-side storage in this workflow. Annotation drafts are validated with Zod, keyed by the source manifest hash and recording UUID, written to browser storage, and immediately read back before the UI reports success. A failed, blocked, or silently ignored write is reported as an error. Export creates human transcription and business-annotation revisions, copies original audio bytes, rebuilds the manifest and hashes, then reopens the completed ZIP through the same validator before passing it to browser downloads. It never overwrites the source archive.

## Export boundary

Research ZIP creation is a domain service below the screens. It rechecks current per-use consent, removes private administrative fields, preserves original audio, hashes each member, then extracts and verifies the completed ZIP. The separate administrative backup serializes SQLite and all audio. Restore verifies schema, hashes, SQLite integrity, foreign keys, and audio references before replacement, with a local rollback copy during the operation.

`react-native-zip-archive` adds native code, so export/restore works in a development or standalone APK but not Expo Go. No backend, account, network request, or automatic upload exists.
