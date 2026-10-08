# Physical Android field-test checklist

Record device model, Android version, APK identifier/SHA-256, workflow run or build source, tester, date, and results. Do not mark the milestone field-ready from CI, emulator, or source-only testing.

- Install the release APK and launch it with airplane mode enabled and no development server.
- Confirm seeded project/scenarios, create/edit/archive generic project and scenario records, and verify **Use for data collection** changes the dashboard/current collection context without altering existing records.
- Register a fictional participant; confirm its pseudonymous speaker ID is generated automatically and common language, age, gender, and business values can be selected or entered through **Other**.
- On participant, consent, and scenario forms, focus every bottom field and verify Android resizes/scrolls the form so the keyboard never covers the active input or save button.
- Prove microphone remains disabled before valid internal-research consent.
- Start, pause, close, reopen, and resume a session without re-entering its participant; accidentally complete it and verify **Reopen completed session** restores collection only with valid consent.
- Remove an incorrect empty session and an incorrect session containing test recordings; confirm both disappear from participant sessions, child recordings disappear from the library/dashboard, and neither appears in a research dataset export.
- Deny microphone permission, recover through Android settings, and record a real take.
- Interrupt a take with screen lock/app switch/phone call; confirm no false success and safe retry/cleanup.
- Record, stop, play the temporary take to the end at least three times, rerecord/discard, accept, and confirm no Android `ArrayBuffer`/Blob error occurs.
- Edit a scenario with ten unique fictional examples, restart the app, and confirm all ten persist. Share them to WhatsApp and confirm the message contains only the guidance plus ten numbered bold examples, while speaker/submission/scenario/instruction fields remain inside SautiForge.
- Return ten voice notes through WhatsApp, select all ten through Android, and verify the review queue count. Play each file, explicitly select its matching example, correct transport/prompt exposure, and save it before advancing. Discard one file and confirm the others remain queued; cancel another batch and confirm all unsaved cache files are removed.
- Attempt to save an example-exposed recording without selecting its exact example and confirm it is rejected. Confirm a second import of the same active audio is also rejected as a duplicate.
- Review the imported recording and exported JSONL; confirm the original container plus import provenance and SHA-256 are accurate. Verify the workflow after app restart because SautiForge does not read or track WhatsApp delivery.
- Select each predefined code-switching value (`none`, `present`, `ambiguous`, `unknown`); save metadata, restart, reboot, and play again.
- Fill storage near the safety threshold and confirm recording/export stop with an explicit error.
- Finish all scenarios, open the recording library from the session, then edit verbatim and normalized text twice; confirm both revisions and human provenance remain visible.
- Add business labels with unknown/ambiguous/unavailable values; update status and search/filter the library.
- Withdraw or narrow consent; confirm later recording is blocked and ineligible sharing categories exclude prior audio.
- Export each sharing category, save via Android folder picker, and transfer the ZIP to a computer.
- Independently extract the ZIP, run `npm run validate:export -- <directory>`, and play every audio member.
- Create a private backup, restore it on a clean test install, restart, and compare database/audio counts and hashes.
- Simulate cancellation and insufficient storage during export/restore; confirm local source data remains usable.
- Verify private consent/administrative fields never appear in a default research export.
- From a recording detail screen, remove an intentional duplicate and verify that it disappears from the library, dashboard counts, and research export while remaining in an administrative backup.
- Import audio without choosing its matching example; verify that a plain-language message appears beside the selector instead of raw validation JSON.
- Complete every active scenario target for one participant and verify the card turns gold; add verbatim transcripts to every retained recording and verify it turns green.
