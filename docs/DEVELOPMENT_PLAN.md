# Development plan

## Implemented in source

- Expo SDK 57 TypeScript/Router application and APK build profile.
- GitHub Actions pilot APK workflow with verification, release assembly, SHA-256, and short-lived downloadable artifacts; first successful release assembly recorded in `BUILD_VERIFICATION.md`.
- SQLite schema version 5, migration chain, constraints, seed project, and five editable Kingwana scenarios.
- Offline projects, scenarios, pseudonymous participants, immutable consent revisions, resumable sessions, consent-checked reopening, and atomic soft-removal of incorrect sessions and their recordings.
- Real foreground audio capture, immediate playback, accept/rerecord/discard, document-storage persistence, and verified database save.
- Consent-gated Android batch sharing of persistent scenario examples with internal-only research linkage, plus multi-file external-audio selection, sequential playback/review, explicit example matching, original-container preservation, SHA-256 duplicate detection, and transport/prompt provenance. This does not read WhatsApp chats or confirm delivery.
- Dashboard, searchable recording library, detail playback, workflow status, soft archive, human transcription revisions, and versioned business annotations.
- Complete library filters for project, participant, scenario, language, date range, quality, and annotation status.
- Settings/safety status for microphone permission, free storage, versions, offline behavior, and startup recording-file reconciliation.
- Consent-filtered research ZIP, portable JSON/JSONL/CSV metadata, SHA-256 manifest, post-compression extraction verification, Android folder/share flows, and export history.
- Separate sensitive administrative backup and verified rollback-capable restore.
- Portable computer-side export validator for post-transfer size, SHA-256, path, count, and audio-reference checks.
- Automated tests across every feature module and the portable validator, including green brand-palette consistency across launch and interface configuration, executed SQLite migrations/relationships, scenario example validation, participant and recording-metadata selectors, session state recovery/removal, privacy-minimized batch sharing and queue progression, external-audio validation/hashing/provenance/duplicate checks, repeat playback, full library query construction, recording interruption/save recovery, accepted-file readability, strict privacy-minimized export contracts, restore preflight, and manifest references (29 files, 92 tests).

## Required before field-ready status

1. Install the generated standalone Android APK on the target phone.
2. Exercise the complete workflow on the target physical phone with airplane mode enabled.
3. Test microphone denial/re-enable, phone-call interruption, low storage, process death during take/save, restart, and device reboot.
4. Share ten examples and select ten actual WhatsApp voice notes through Android; verify sequential review, explicit example matching, repeat playback, discard/exit cleanup, duplicate rejection, and provenance after restart.
5. Transfer a research ZIP to a computer, independently verify its hashes/references, and inspect/play every sample file.
6. Restore a private backup onto a clean test installation and compare record/audio counts and hashes.
7. Record device model, Android version, results, failures, and any workaround in a signed-off field-test report.

Pause/resume recording remains disabled until it is stable on the target device. App-private storage and an unencrypted backup ZIP are not a complete security strategy; deployment requires Android device encryption, screen/application access controls, restricted backup handling, and a documented withdrawal process.

## Future, outside MVP

Automatic messaging ingestion, optional synchronization, contributor accounts, task assignment, collaborative review, permitted official API integrations, WAV conversion, and model-assisted suggestions remain future work. They must build on portable IDs and provenance rather than alter the offline collection core.
