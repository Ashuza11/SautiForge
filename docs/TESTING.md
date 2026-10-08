# Testing strategy and coverage

Run automated checks with:

```bash
npm run typecheck
npm test
npx expo-doctor
npx expo export --platform android
```

Current automated suite: 33 files, 105 tests.

The `Android pilot APK` GitHub Actions workflow repeats type-checking/tests, runs Expo prebuild, builds `:app:assembleRelease` with Java 17, and publishes the APK plus SHA-256. A green workflow proves compilation and artifact creation, but not installation, microphone behavior, or offline device persistence.

Release assembly first passed in [run 35874820535](https://github.com/Ashuza11/SautiForge/actions/runs/35874820535) for commit `142375373dd4ac119abb5b6627bf9d46a0cdc916`. The evidence and its limits are recorded in `BUILD_VERIFICATION.md`.

| Feature | Automated coverage | Native/field coverage still required |
| --- | --- | --- |
| Projects | Required fields and reusable project validation | Screen CRUD and restart persistence |
| Scenarios | Versioned reusable prompt/reference validation plus bounded, unique, line-separated remote example sets | Screen CRUD, batch-example editing, and historical prompt snapshot inspection |
| Participants | Pseudonymous required fields, generated speaker IDs, demographic bounds, common selector values, custom values, and collection/transcription progress derived from active scenarios and retained recordings | Screen CRUD, selector interaction, uniqueness error UX, and visual progress verification |
| Consent | Recording gate, expiry, withdrawal, and each sharing category | Microphone gate and export exclusion on device |
| Sessions | Environment/nullability, exact consent linkage, valid reopen transitions, consent-checked recovery, verified persistence, and atomic soft-removal of sessions and child recordings | Pause, close, resume/reopen/remove, and process restart |
| Recordings | Spoken-language/quality validation, predefined code-switching values, repeat-playback reset, interrupted-take stop/discard/error handling, save compensation, non-empty accepted-file readability, imported format/provenance validation, clear missing-example feedback, multi-example remote prompt, exact example/source-file export provenance, and duplicate-content rejection | Permission, actual microphone, phone-call behavior, file verification, repeated playback, Android share target, ten-file WhatsApp/document-provider queue, explicit example matching, reboot, low storage |
| Transcriptions | Independent verbatim/normalized text, optional transcript, revision provenance | Edit/history UI persistence |
| Annotations | Versioned strict payload, optional/unknown values, privacy field rejection | Edit/history UI persistence |
| Dashboard | Aggregate mapping and empty-state zeroes | Counts against device SQLite data |
| Library | Bound query construction for project, participant, scenario, language, date range, quality, status, and soft-archive exclusion | Full filter and soft-archive UI workflow |
| Exports | Strict record-level privacy contracts, embedded JSON, safe audio paths, manifest schema/references, plus portable post-transfer size/hash/count/reference validation | Native ZIP creation/extraction, Android folder/share, and validation of a real transferred archive |
| Restore | Migration chain execution, foreign keys, uniqueness, exact member set, unsafe/encrypted/duplicate entry rejection, and conservative storage preflight | Native ZIP picker, rollback injection, low-storage simulation, clean-device restore comparison |
| Settings | Strict local settings and storage-recovery report schemas, complete English/French/Kiswahili dictionaries, and write-read verification of the interface language | Permission presentation, language switching across screens, and restart persistence |
| File recovery | Verified/missing/empty/orphan classification | Startup quarantine with real interrupted files and process death |

The migration tests execute all five migration SQL scripts against an in-memory SQLite database and check table creation, foreign-key enforcement, speaker-code uniqueness, imported-audio provenance, scenario examples, and elicitation linkage. Native modules cannot be proven by Node unit tests: all microphone, multi-file document-provider, sharing, ZIP-native, reboot, and interruption cases remain explicit gates in `FIELD_TEST_CHECKLIST.md`.
