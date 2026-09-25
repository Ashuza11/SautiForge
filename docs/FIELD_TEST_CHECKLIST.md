# Physical Android field-test checklist

Record device model, Android version, APK identifier/SHA-256, workflow run or build source, tester, date, and results. Do not mark the milestone field-ready from CI, emulator, or source-only testing.

- Install the release APK and launch it with airplane mode enabled and no development server.
- Confirm seeded project/scenarios, create/edit/archive generic project and scenario records, and verify **Use for data collection** changes the dashboard/current collection context without altering existing records.
- Register a fictional participant; confirm its pseudonymous speaker ID is generated automatically and common language, age, gender, and business values can be selected or entered through **Other**.
- On participant, consent, and scenario forms, focus every bottom field and verify Android resizes/scrolls the form so the keyboard never covers the active input or save button.
- Prove microphone remains disabled before valid internal-research consent.
- Start, pause, close, reopen, and resume a session without re-entering its participant.
- Deny microphone permission, recover through Android settings, and record a real take.
- Interrupt a take with screen lock/app switch/phone call; confirm no false success and safe retry/cleanup.
- Record, stop, play, rerecord/discard, accept, and confirm no Android `ArrayBuffer`/Blob error occurs; save metadata, restart, reboot, and play again.
- Fill storage near the safety threshold and confirm recording/export stop with an explicit error.
- Edit verbatim and normalized text twice; confirm both revisions and human provenance remain visible.
- Add business labels with unknown/ambiguous/unavailable values; update status and search/filter the library.
- Withdraw or narrow consent; confirm later recording is blocked and ineligible sharing categories exclude prior audio.
- Export each sharing category, save via Android folder picker, and transfer the ZIP to a computer.
- Independently extract the ZIP, run `npm run validate:export -- <directory>`, and play every audio member.
- Create a private backup, restore it on a clean test install, restart, and compare database/audio counts and hashes.
- Simulate cancellation and insufficient storage during export/restore; confirm local source data remains usable.
- Verify private consent/administrative fields never appear in a default research export.
