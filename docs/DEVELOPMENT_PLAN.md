# Development plan

## Implemented in source

- Expo SDK 57 TypeScript/Router application and APK build profile.
- GitHub Actions pilot APK workflow with verification, release assembly, SHA-256, and short-lived downloadable artifacts (execution not yet verified).
- SQLite schema version 3, migration chain, constraints, seed project, and five editable Kingwana scenarios.
- Offline projects, scenarios, pseudonymous participants, immutable consent revisions, and resumable sessions.
- Real foreground audio capture, immediate playback, accept/rerecord/discard, document-storage persistence, and verified database save.
- Dashboard, searchable recording library, detail playback, workflow status, soft archive, human transcription revisions, and versioned business annotations.
- Complete library filters for project, participant, scenario, language, date range, quality, and annotation status.
- Settings/safety status for microphone permission, free storage, versions, offline behavior, and startup recording-file reconciliation.
- Consent-filtered research ZIP, portable JSON/JSONL/CSV metadata, SHA-256 manifest, post-compression extraction verification, Android folder/share flows, and export history.
- Separate sensitive administrative backup and verified rollback-capable restore.
- Portable computer-side export validator for post-transfer size, SHA-256, path, count, and audio-reference checks.
- Automated tests across every feature module and the portable validator, including executed SQLite migrations/relationships, full library query construction, recording recovery classification, strict privacy-minimized export contracts, and manifest references (16 files, 46 tests).

## Required before field-ready status

1. Produce and install the standalone Android APK.
2. Exercise the complete workflow on the target physical phone with airplane mode enabled.
3. Test microphone denial/re-enable, phone-call interruption, low storage, process death during take/save, restart, and device reboot.
4. Transfer a research ZIP to a computer, independently verify its hashes/references, and inspect/play every sample file.
5. Restore a private backup onto a clean test installation and compare record/audio counts and hashes.
6. Record device model, Android version, results, failures, and any workaround in a signed-off field-test report.

Pause/resume recording remains disabled until it is stable on the target device. App-private storage and an unencrypted backup ZIP are not a complete security strategy; deployment requires Android device encryption, screen/application access controls, restricted backup handling, and a documented withdrawal process.

## Future, outside MVP

Optional synchronization, contributor accounts, task assignment, collaborative review, permitted messaging integrations, WAV conversion, and model-assisted suggestions remain future work. They must build on portable IDs and provenance rather than alter the offline collection core.
