# Testing strategy and coverage

Run automated checks with:

```bash
npm run typecheck
npm test
npx expo-doctor
npx expo export --platform android
```

Current automated suite: 12 files, 36 tests.

| Feature | Automated coverage | Native/field coverage still required |
| --- | --- | --- |
| Projects | Required fields and reusable project validation | Screen CRUD and restart persistence |
| Scenarios | Versioned reusable prompt/reference validation | Screen CRUD and historical prompt snapshot inspection |
| Participants | Pseudonymous required fields and demographic bounds | Screen CRUD and uniqueness error UX |
| Consent | Recording gate, expiry, withdrawal, and each sharing category | Microphone gate and export exclusion on device |
| Sessions | Environment/nullability and exact consent linkage | Pause, close, resume, and process restart |
| Recordings | Spoken-language and quality validation | Permission, actual microphone, interruption, file verification, playback, reboot, low storage |
| Transcriptions | Independent verbatim/normalized text, optional transcript, revision provenance | Edit/history UI persistence |
| Annotations | Versioned strict payload, optional/unknown values, privacy field rejection | Edit/history UI persistence |
| Dashboard | Aggregate mapping and empty-state zeroes | Counts against device SQLite data |
| Library | Search/filter query inputs rely on recording validation and SQLite constraints | Full filter and soft-archive UI workflow |
| Exports | Manifest schema, paths, hashes, and audio-reference consistency | Native ZIP creation/extraction, Android folder/share, computer-side validation |
| Restore | Migration chain execution, foreign keys, uniqueness, manifest references | Native ZIP picker, rollback injection, clean-device restore comparison |
| Settings | Strict local settings schema | Active project persistence |

The migration tests execute all three migration SQL scripts against an in-memory SQLite database and check table creation, foreign-key enforcement, and speaker-code uniqueness. Native modules cannot be proven by Node unit tests: all microphone, document-provider, sharing, ZIP-native, reboot, and interruption cases remain explicit gates in `FIELD_TEST_CHECKLIST.md`.
