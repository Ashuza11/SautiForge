# SautiForge

SautiForge is an offline-first Android application for collecting and managing consented, pseudonymous speech research data. It is designed for low-resource-language fieldwork and keeps projects, participants, sessions, scenarios, recordings, transcripts, and annotations separate.

Version 0.1 is being built for a pilot in Bukavu, Democratic Republic of Congo. The included Kingwana project is editable seed data, not application logic.

## Current implementation

The first vertical slice includes:

- Expo SDK 57, React Native, TypeScript, and Expo Router application structure.
- A versioned `expo-sqlite` database with foreign keys and WAL journaling.
- All MVP entity tables, stable UUID keys, timestamps, constraints, and indexes.
- First-run Kingwana pilot project and five editable scenario records.
- Working offline project creation, editing, selection, and soft archival.
- Working scenario creation, editing, versioning, structured reference data, and soft archival.
- Pseudonymous participant registration/editing with data-minimized optional demographics.
- Append-only consent revisions, per-use approvals, visible history, and reusable recording/export authorization checks.
- Consent-linked, resumable collection sessions with device/environment metadata.
- Real foreground microphone recording, visible timer/indicator, immediate playback, rerecord/discard confirmation, and verified accepted-file persistence in document storage.
- Dashboard counts, a recording library filterable by project/participant/scenario/language/date/quality/status, detail playback, soft archive, status changes, human transcription revision history, and versioned business annotations.
- Startup storage reconciliation that reports missing audio and quarantines zero-byte or unreferenced recording files for recovery.
- Settings and safety status for microphone permission, free space, versions, offline behavior, backup limits, and the latest storage check.
- Consent-filtered research ZIP exports with JSON/JSONL/CSV metadata, original audio, SHA-256 manifest, and post-compression verification.
- A visibly separate sensitive administrative backup and hash/schema/database/audio-verified restore with rollback on failure.
- Strict Zod validation for persisted and exported records, a portable post-transfer dataset validator, and 46 automated tests including real in-memory SQLite migration/relationship checks.
- Android APK build profile in `eas.json`.
- A verified GitHub Actions release build that produces a standalone pilot APK and SHA-256 sidecar.

The first standalone APK was produced successfully from commit `142375373dd4ac119abb5b6627bf9d46a0cdc916` by [GitHub Actions run 35874820535](https://github.com/Ashuza11/SautiForge/actions/runs/35874820535). Installation, recording, ZIP export, and restore have not yet been exercised on the target physical phone. The application is therefore **not yet field-ready**.

## Local development

Prerequisites: Node.js 20+, npm, Android Studio/Android SDK for local device work, and an Android phone or emulator.

```bash
npm install
npm run typecheck
npm test
npx expo start
```

Because ZIP support contains native Android code, export and restore require a development build or standalone APK and do not work in Expo Go.

To run on a USB-connected Android device during development:

```bash
npm run android
```

The app uses only on-device SQLite. No account or backend is required.

To validate a research ZIP after transfer to a computer, extract it and run:

```bash
npm run validate:export -- path/to/extracted-export
```

## Installable Android build

The `pilot` EAS profile creates an installable APK rather than an AAB:

```bash
npx eas-cli@latest build --platform android --profile pilot
```

This hosted build command requires an Expo account and network access. A future local-build workflow can use `eas build --local` once the Android build environment and signing credentials are configured. Install a downloaded APK with:

```bash
adb install path/to/sautiforge.apk
```

An EAS account is a build-time option only; the installed application must work offline and does not require an end-user account.

### GitHub Actions pilot APK

Every relevant push to `main`, or a manual run of **Android pilot APK** under the repository’s Actions tab, runs type-checks and tests, generates the native Android project, builds `:app:assembleRelease`, and uploads an installable APK with a SHA-256 file. Download the `sautiforge-android-pilot-<run>` artifact from the successful workflow run, extract it, verify it, then install it:

```bash
sha256sum -c sautiforge-*.apk.sha256
adb install -r sautiforge-*.apk
```

This pilot artifact uses the generated Android debug signing configuration so it can be installed without storing signing secrets in GitHub. It is not suitable for Play Store or production distribution. Establish protected production signing and key custody before any production release.

See [build verification](docs/BUILD_VERIFICATION.md) for the exact source commit, workflow result, artifact metadata, and remaining device-validation boundary.

## Data and ethics

- Use pseudonymous speaker codes and collect no unnecessary identifiers.
- Never record mobile-money PINs, credentials, identifiable customer transactions, or private customer conversations.
- Use fictional or sanitized pilot examples.
- Consent and future contact information must remain outside default research dataset exports.
- App-private storage is not a complete backup or encryption strategy. Field deployment requires device encryption, access controls, tested backup/restore, and a consent-withdrawal procedure.

See [Architecture](docs/ARCHITECTURE.md), [schema](docs/SCHEMA.md), [development plan](docs/DEVELOPMENT_PLAN.md), [test coverage](docs/TESTING.md), [field-test checklist](docs/FIELD_TEST_CHECKLIST.md), and [export format](docs/EXPORT_FORMAT.md).
