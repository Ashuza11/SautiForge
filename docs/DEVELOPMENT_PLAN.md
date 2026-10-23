# Development plan

## Implemented in source

- Expo SDK 57 TypeScript/Router application and APK build profile.
- GitHub Actions pilot APK workflow with verification, release assembly, SHA-256, and short-lived downloadable artifacts; first successful release assembly recorded in `BUILD_VERIFICATION.md`.
- SQLite schema version 8, migration chain, constraints, prompt-correction audit history, editable transcription context, ISO 639-3/project annotation configuration, the Kingwana seed project, five editable Kingwana scenarios, and the editable Mashi (`shr`) pilot.
- Offline projects, scenarios, pseudonymous participants, immutable consent revisions, resumable sessions, consent-checked reopening, and atomic soft-removal of incorrect sessions and their recordings.
- Real foreground audio capture, immediate playback, accept/rerecord/discard, document-storage persistence, and verified database save.
- Consent-gated Android batch sharing of persistent scenario examples with internal-only research linkage, plus multi-file external-audio selection, sequential playback/review, explicit example matching, original-container preservation, SHA-256 duplicate detection, and transport/prompt provenance. This does not read WhatsApp chats or confirm delivery.
- Dashboard, searchable recording library, detail playback, workflow status, soft archive, human transcription revisions with editable scenario/example context, and versioned business annotations with common-value selectors.
- Complete library filters for project, participant, scenario, language, date range, quality, and annotation status.
- Settings/safety status for microphone permission, free storage, versions, offline behavior, and startup recording-file reconciliation.
- Consent-filtered research ZIP, portable JSON/JSONL/CSV metadata, SHA-256 manifest, post-compression extraction verification, Android folder/share flows, and export history.
- Separate sensitive administrative backup and verified rollback-capable restore.
- Portable computer-side export validator for post-transfer size, SHA-256, path, count, and audio-reference checks.
- Automated tests across the Android, web, export, and server feature boundaries, including localization, SQLite relationships, recording recovery/provenance, verified browser persistence/exports, server authorization, reusable project CRUD, Neon row mapping, PostgreSQL migration constraints, readiness, and private-object-storage controls (48 files, 172 tests).
- Static responsive web annotation workspace with local-only research ZIP selection, shared runtime schemas, manifest/file hash validation, administrative-backup rejection, searchable recordings, audio playback, project-aware transcription/context editing, Kingwana-only business labels, read-after-write-verified browser drafts, and verified derivative research ZIP export with original audio.
- Reusable web project administration using the shared Android project schema, verified local repository persistence, edit/archive actions, and portable configuration download. A remote repository adapter remains a later backend batch.
- Separate Hono community-service foundation with server-only configuration, protected project endpoints, Neon/PostgreSQL migration and repository, private S3-compatible signing boundary, bounded requests, readiness checks, CI verification, and deployment documentation. It is deliberately not connected to GitHub Pages before scoped administrator sessions exist.

The V2 repository audit and phased Mashi/community plan are maintained in `COMMUNITY_V2_ARCHITECTURE.md`. The first two V2 slices are implemented; deployment, scoped web sessions, source rights, segmentation, remote community tasks, independent annotation, and review are not.

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
