# Local schema version 8

The authoritative migration is `src/core/database/migrations.ts`. SQLite stores metadata; audio files are stored by verified relative path in the application document directory.

| Table | Purpose |
| --- | --- |
| `projects` | Reusable study configuration, ISO 639-3 code, annotation profile, and protocol version |
| `scenarios` | Versioned prompts scoped to a project |
| `participants` | Pseudonymous research participant metadata |
| `consent_records` | Append-only consent decisions and approved uses |
| `sessions` | Resumable collection activity for one participant and project |
| `recordings` | Verified audio references, media metadata, scenario snapshot, and workflow state |
| `transcriptions` | Revisioned verbatim/normalized text plus editable scenario/example context and provenance |
| `annotations` | Revisioned, schema-versioned annotation payloads kept separate from generic recording metadata |
| `export_history` | Explicit export attempts, destinations, hashes, and errors |
| `recording_prompt_corrections` | Append-only administrative audit trail for corrected imported-recording example associations |
| `app_settings` | Small local preferences such as the active project |

Deletion uses restrictive foreign keys for research records. Projects, scenarios, participants, sessions, and recordings expose status/archive fields instead of destructive cascading deletion. Removing an incorrect session atomically marks the session and all its recordings as archived; audio and related records remain available only through the restricted administrative backup path.

Consent updates are new records linked through `supersedes_id`; previous decisions are not silently overwritten. Export authorization must use the latest applicable consent record at the time of export and record the selected sharing category.

Database versioning starts at `1` and uses incremental migrations guarded by `PRAGMA user_version`. Version 2 adds an explicit consent-protocol version to every historical consent record. Version 3 links sessions and recordings to the exact consent revision that authorized collection. Version 4 records imported-audio source, transport, prompt exposure, import timestamp, MIME type, SHA-256 hash, and pseudonymous submission code. Version 5 adds persistent scenario example sets plus exact elicitation-example and source-filename provenance on recordings. Version 6 adds reasoned prompt-association correction history while the recording row retains the current value used by research exports. Version 7 adds editable, revisioned scenario and example context to transcriptions. Version 8 adds project ISO 639-3 and annotation-profile configuration, retains Kingwana's business profile, and adds the editable Mashi (`shr`) verbatim-transcription pilot without changing the active project. Imported audio hashes are indexed for duplicate detection; archived mistakes do not prevent a deliberate replacement import.

## Community service schema

The separate Neon/PostgreSQL service has its own numbered migrations under `server/migrations`; it does not replace or synchronize the Android SQLite database.

| Table | Purpose |
| --- | --- |
| `projects` | Language-independent remote project configuration compatible with the shared project contract |
| `sources` | Project-scoped discovery/provenance metadata, language verification, speaker-identification status, lifecycle status, and current rights revision number |
| `source_rights_revisions` | Append-only rights holder, evidence reference, attribution, decision, administrator provenance, and five independent authorized-use flags |
| `source_media` | Original authorized audio/video master upload attempts, private object keys, exact authorizing rights revisions, expected SHA-256/size/type, and verified or failed storage state |
| `schema_migrations` | Applied migration names, SHA-256 checksums, and timestamps |

`source_media` is not an audio blob table: bytes remain in private S3-compatible storage. The database accepts a verified transition only while current source rights still authorize internal processing. It retains failed attempts for auditability and does not imply that verified media remains authorized after a later revocation.

The service deliberately has no clip, task, remote participant, or community annotation tables yet. These are introduced only with their working lifecycle and authorization rules.
