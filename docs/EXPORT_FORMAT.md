# Export and backup format 1.0.0

SautiForge creates ZIP archives offline. Each archive is staged, hashed, compressed, extracted into a second temporary directory, and checked byte-for-byte before the app reports success. Temporary archives remain in cache until Android saves or shares them; local source recordings are never deleted.

## Research dataset

```text
sautiforge-<project>-<date>-<export-id-prefix>.zip
├── manifest.json
├── metadata/
│   ├── project.json
│   ├── scenarios.jsonl
│   ├── participants.jsonl
│   ├── participants.csv
│   ├── sessions.jsonl
│   ├── recordings.jsonl
│   ├── transcriptions.jsonl
│   └── annotations.jsonl
└── audio/
    └── <recording-uuid>.<original-extension>
```

JSONL files contain one UTF-8 JSON object per line. CSV is RFC-4180-style UTF-8 with every populated value quoted and embedded quotes doubled. Database column names are retained in `snake_case`; JSON-valued columns end in `_json`. `recordings.jsonl` replaces the private application path with an `audio_path` relative to the ZIP root.

`manifest.json` contains `schemaVersion`, stable export ID, ISO 8601 export time, export type, database version, project ID, sharing category, record counts, and every data/audio member’s relative path, byte size, and lowercase SHA-256 hash. The manifest itself is not self-hashed; its SHA-256 is stored in local `export_history`.

Research exports evaluate the participant’s latest consent revision at export time. They include only eligible, non-archived recordings and the participants/sessions they reference. They exclude consent records, consent notes, participant research notes, session researcher notes, database files, and recordings withdrawn from the selected sharing category. Scenario prompt snapshots and original container/codec metadata remain attached to recordings. M4A/AAC is never described as WAV.

## Restricted administrative backup

```text
sautiforge-private-backup-<date>-<export-id-prefix>.zip
├── manifest.json
├── database.sqlite
└── recordings/
    └── <project-uuid>/<recording-uuid>.<original-extension>
```

This archive contains the complete SQLite database, consent history, administrative notes, and all referenced audio. It is deliberately separate from research export and visibly marked sensitive. Version 0.1 does not encrypt the ZIP; it must be stored only on an access-controlled, encrypted device or volume.

Restore accepts administrative backups only. Before replacement it validates ZIP paths, the manifest schema, every size/hash, database version, SQLite integrity, foreign keys, and every database-to-audio reference. Existing files affected by restore and the current database are retained temporarily for rollback. If replacement fails, SautiForge restores the prior files and database. Restart the app after a successful restore so every screen reloads current state.

## Compatibility

- Export schema: `1.0.0`
- SQLite schema: `3`
- Audio conversion: not performed
- Restore policy: exact supported SQLite version only
- ZIP creation requires an APK/development build; the native ZIP module is unavailable in Expo Go.
