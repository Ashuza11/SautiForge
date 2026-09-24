# Android build verification

## First successful standalone build

| Evidence | Value |
| --- | --- |
| Workflow | `Android pilot APK` |
| Run | [35874820535](https://github.com/Ashuza11/SautiForge/actions/runs/35874820535) |
| Result | Successful |
| Completed | 2026-09-23 14:55 UTC |
| Source commit | `142375373dd4ac119abb5b6627bf9d46a0cdc916` |
| APK filename | `sautiforge-0.1.0-14237537-pilot.apk` |
| Artifact | `sautiforge-android-pilot-1` |
| Artifact archive size | 52,425,137 bytes |
| GitHub artifact archive digest | `sha256:bc1d7e14e2a188a7c03c16be186899872a20290ab801850b1b78cf416ee593f9` |
| Artifact expiry | 2026-10-07 14:55 UTC |

The job passed locked dependency installation, TypeScript validation, all 46 automated tests, Expo Android prebuild, Gradle release assembly, APK naming/checksum creation, and artifact upload. The uploaded archive contains the APK and its `.sha256` sidecar. GitHub's archive digest above verifies the uploaded ZIP as a whole; use the sidecar to verify the extracted APK itself.

## Verification procedure

1. Download `sautiforge-android-pilot-1` from the workflow run before its expiry.
2. Extract the artifact archive.
3. In the extracted directory, run `sha256sum -c sautiforge-0.1.0-14237537-pilot.apk.sha256`.
4. Record that APK SHA-256, the phone model, and Android version in the field-test report.
5. Install with `adb install -r sautiforge-0.1.0-14237537-pilot.apk` and execute `FIELD_TEST_CHECKLIST.md`.

Subsequent workflow runs write the APK filename, APK SHA-256, full source commit, and pilot-signing warning to the GitHub job summary as well as the downloadable sidecar.

## Boundary of this evidence

This result proves that a standalone Android package can be assembled from the committed source and uploaded. It does not prove installation, offline launch, microphone capture, persistent playback, Android document export, low-storage behavior, interruption recovery, reboot survival, or backup restoration on a physical phone. SautiForge remains not field-ready until those checks are completed and recorded.
