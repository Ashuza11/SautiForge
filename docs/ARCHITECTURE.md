# Architecture

## Shape

SautiForge is a single offline-first Expo application. Screens depend on repository interfaces; SQLite implementations live below those interfaces. This keeps presentation code independent from storage details and leaves room for a later opt-in synchronization adapter without building a backend now.

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
- A recording stores a scenario version and prompt snapshot, not only a mutable scenario foreign key.
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

Background recording, automatic uploads, remote authentication, and AI transcription are out of scope for 0.1.

## Export boundary

Research ZIP creation is a domain service below the screens. It rechecks current per-use consent, removes private administrative fields, preserves original audio, hashes each member, then extracts and verifies the completed ZIP. The separate administrative backup serializes SQLite and all audio. Restore verifies schema, hashes, SQLite integrity, foreign keys, and audio references before replacement, with a local rollback copy during the operation.

`react-native-zip-archive` adds native code, so export/restore works in a development or standalone APK but not Expo Go. No backend, account, network request, or automatic upload exists.
