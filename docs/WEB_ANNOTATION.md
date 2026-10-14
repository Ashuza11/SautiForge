# Local web annotation workflow

## Purpose

The web workspace makes computer-based review faster while preserving SautiForge's offline and data-minimization boundaries. It is a static browser application: there is no backend, account, automatic synchronization, analytics, or dataset upload.

## Implemented workflow

1. Export a consent-filtered **research dataset** ZIP from the Android app and transfer it to the computer through an authorized method.
2. Run `npm run web:dev` and choose the ZIP in the browser.
3. The browser validates the manifest schema, safe relative paths, declared member set, record counts, file sizes, SHA-256 hashes, audio references, and research record schemas before opening the workspace.
4. Search by recording ID, pseudonymous speaker code, scenario, language, or annotation status; play audio and inspect frozen prompt context and the latest transcript.
5. Edit verbatim and normalized text, language tags, notes, scenario/example context, researcher code, workflow status, and structured business labels. Source values are prefilled but remain editable.
6. Save a local draft. SautiForge validates it, writes it under the source manifest hash and recording ID, and reads it back before showing a success message.
7. Download an annotated ZIP. SautiForge creates human revision records, retains the original audio bytes, rebuilds portable metadata and all member hashes, reopens and validates the generated archive, and reports its archive SHA-256 before reporting success.

Private administrative backups are deliberately rejected. The selected archive remains in browser memory and is not modified. Keep the original ZIP and its checksum as the authoritative recovery copy.

## Current limitations

- Only explicitly saved local drafts are included in the annotated export. Unsaved edits are not exported.
- Browser storage is not an encrypted research backup. Use a secured computer profile and clear drafts before another person uses the profile.
- Browser playback depends on native codec support. Original Opus files remain unchanged even if a particular browser requires a separate research derivative for another tool.
- ZIP extraction currently occurs in memory and must be exercised with the full pilot archive before field use.
- Closing or refreshing the page discards the open ZIP/audio workspace; saved drafts remain in that browser profile and reappear after reopening the exact source archive.

Create a production build with `npm run web:build`. The generated `web-dist/` directory is intentionally ignored by Git.

## Static hosting

The `Web annotation workspace` workflow builds and deploys `web-dist/` to GitHub Pages. Enable **GitHub Actions** as the Pages source once in repository settings, then use `https://ashuza11.github.io/SautiForge/`. The hosted files contain application code only. Dataset ZIPs, decoded audio, local drafts, and annotated exports are processed by browser APIs and are not workflow artifacts or network uploads.
