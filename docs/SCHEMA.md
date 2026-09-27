# Local schema version 4

The authoritative migration is `src/core/database/migrations.ts`. SQLite stores metadata; audio files are stored by verified relative path in the application document directory.

| Table | Purpose |
| --- | --- |
| `projects` | Reusable study configuration and protocol version |
| `scenarios` | Versioned prompts scoped to a project |
| `participants` | Pseudonymous research participant metadata |
| `consent_records` | Append-only consent decisions and approved uses |
| `sessions` | Resumable collection activity for one participant and project |
| `recordings` | Verified audio references, media metadata, scenario snapshot, and workflow state |
| `transcriptions` | Revisioned verbatim/normalized text with provenance |
| `annotations` | Revisioned, schema-versioned annotation payloads kept separate from generic recording metadata |
| `export_history` | Explicit export attempts, destinations, hashes, and errors |
| `app_settings` | Small local preferences such as the active project |

Deletion uses restrictive foreign keys for research records. Projects, scenarios, participants, sessions, and recordings expose status/archive fields instead of destructive cascading deletion. Removing an incorrect session atomically marks the session and all its recordings as archived; audio and related records remain available only through the restricted administrative backup path.

Consent updates are new records linked through `supersedes_id`; previous decisions are not silently overwritten. Export authorization must use the latest applicable consent record at the time of export and record the selected sharing category.

Database versioning starts at `1` and uses incremental migrations guarded by `PRAGMA user_version`. Version 2 adds an explicit consent-protocol version to every historical consent record. Version 3 links sessions and recordings to the exact consent revision that authorized collection. Version 4 records whether audio came from the device microphone or a manual import, its transport and prompt exposure, import timestamp, source MIME type, SHA-256 content hash, and pseudonymous external submission code. Imported audio hashes are indexed for duplicate detection; archived mistakes do not prevent a deliberate replacement import.
