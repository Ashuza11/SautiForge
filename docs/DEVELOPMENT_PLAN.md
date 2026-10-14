# Development plan

## Implemented in source

- Expo SDK 57 TypeScript/Router application and APK build profile.
- GitHub Actions pilot APK workflow with verification, release assembly, SHA-256, and short-lived downloadable artifacts; first successful release assembly recorded in `BUILD_VERIFICATION.md`.
- SQLite schema version 7, migration chain, constraints, prompt-correction audit history, editable transcription context, seed project, and five editable Kingwana scenarios.
- Offline projects, scenarios, pseudonymous participants, immutable consent revisions, resumable sessions, consent-checked reopening, and atomic soft-removal of incorrect sessions and their recordings.
- Real foreground audio capture, immediate playback, accept/rerecord/discard, document-storage persistence, and verified database save.
- Consent-gated Android batch sharing of persistent scenario examples with internal-only research linkage, plus multi-file external-audio selection, sequential playback/review, explicit example matching, original-container preservation, SHA-256 duplicate detection, and transport/prompt provenance. This does not read WhatsApp chats or confirm delivery.
- Dashboard, searchable recording library, detail playback, workflow status, soft archive, human transcription revisions with editable scenario/example context, and versioned business annotations with common-value selectors.
- Complete library filters for project, participant, scenario, language, date range, quality, and annotation status.
- Settings/safety status for microphone permission, free storage, versions, offline behavior, and startup recording-file reconciliation.
- Consent-filtered research ZIP, portable JSON/JSONL/CSV metadata, SHA-256 manifest, post-compression extraction verification, Android folder/share flows, and export history.
- Separate sensitive administrative backup and verified rollback-capable restore.
- Portable computer-side export validator for post-transfer size, SHA-256, path, count, and audio-reference checks.
- Automated tests across every feature module and the portable validator, including translation completeness, critical-workflow localization and verified interface-language persistence, green brand-palette consistency across launch and interface configuration, participant collection/transcription progress, clear example-selection and audited-correction validation, executed SQLite migrations/relationships, scenario example validation, participant, recording-metadata and annotation selectors, transcription context persistence/export, session state recovery/removal, privacy-minimized batch sharing and queue progression, external-audio validation/hashing/provenance/duplicate checks, repeat playback, full library query construction, recording interruption/save recovery, accepted-file readability, strict privacy-minimized export contracts, restore preflight, manifest references, web archive validation, verified browser-draft persistence, and annotated derivative ZIP verification (38 files, 128 tests).
- Static responsive web annotation workspace with local-only research ZIP selection, shared runtime schemas, manifest/file hash validation, administrative-backup rejection, searchable recordings, audio playback, prefilled transcription/context/business-label editing, read-after-write-verified browser drafts, and verified derivative research ZIP export with original audio.

## Web annotation sequence

1. **Implemented:** open and verify a research ZIP locally, search recordings, play original audio, and inspect scenario/example context and existing transcripts.
2. **Implemented:** edit verbatim and normalized text, notes, language tags, scenario/example context, structured business labels, researcher code, and workflow status with tested, source-bound local draft persistence.
3. **Implemented:** export a new verified research archive containing original audio, human revision provenance, updated workflow states, portable metadata, and an archive checksum while keeping the imported archive unchanged.
4. Add a tested Label Studio task adapter and documented optional audio conversion workflow for tools that do not accept an original container.
5. **Workflow implemented, enablement pending:** publish only the tested static application through GitHub Pages. No dataset is hosted with it. Browser compatibility, full-pilot memory behavior, download recovery, and a real annotated export remain manual acceptance gates before relying on the hosted workspace.

## Required before field-ready status

1. Install the generated standalone Android APK on the target phone.
2. Exercise the complete workflow on the target physical phone with airplane mode enabled.
3. Test microphone denial/re-enable, phone-call interruption, low storage, process death during take/save, restart, and device reboot.
4. Share ten examples and select ten actual WhatsApp voice notes through Android; verify sequential review, explicit example matching, repeat playback, discard/exit cleanup, duplicate rejection, and provenance after restart.
5. Transfer a research ZIP to a computer, independently verify its hashes/references, and inspect/play every sample file.
6. Restore a private backup onto a clean test installation and compare record/audio counts and hashes.
7. Record device model, Android version, results, failures, and any workaround in a signed-off field-test report.

## Planned WhatsApp import inbox (not implemented)

Do not scan or import the whole WhatsApp media directory automatically. It contains unrelated and potentially private audio, and file metadata does not reliably identify the participant, task, scenario, or example.

The recommended next vertical slice is an Android share target:

1. In WhatsApp, the researcher explicitly selects one or more pilot voice notes and chooses **Share > SautiForge**.
2. SautiForge copies the received `audio/*` content URIs into a private, recoverable pending-import inbox and verifies each copied file before reporting success.
3. The inbox deduplicates files by SHA-256 and shows playback, source filename when available, size, format, and import time. It does not inspect WhatsApp chats or infer contributor identity.
4. The researcher assigns every pending file to a project, participant, session, scenario, and exact example. No file becomes a dataset recording until this review is complete.
5. Saving reuses the existing recording validation and persistence workflow. Cancelled or failed imports remain recoverable or are explicitly discarded.
6. Automated tests cover incoming single/multiple-share parsing, queue persistence, duplicate detection, assignment validation, and save recovery. A physical Android test covers WhatsApp `ACTION_SEND` and `ACTION_SEND_MULTIPLE` behavior.

An optional later experiment may let the researcher grant access to a specific directory through Android's Storage Access Framework and discover new audio files since the last scan. It must remain opt-in, present candidates in the same review inbox, never auto-assign recordings, and be retained only if it works reliably across the target phones and their WhatsApp storage layouts.

Pause/resume recording remains disabled until it is stable on the target device. App-private storage and an unencrypted backup ZIP are not a complete security strategy; deployment requires Android device encryption, screen/application access controls, restricted backup handling, and a documented withdrawal process.

## Future, outside MVP

Automatic messaging ingestion, optional synchronization, contributor accounts, task assignment, collaborative review, permitted official API integrations, WAV conversion, and model-assisted suggestions remain future work. They must build on portable IDs and provenance rather than alter the offline collection core.
