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

Private administrative backups are deliberately rejected. The selected archive remains in browser memory and is not modified. Keep the original ZIP and its checksum as the authoritative recovery copy.

## Current limitations

- Local drafts remain in that browser profile and are not yet part of an export. Enriched dataset export is not yet implemented.
- Browser storage is not an encrypted research backup. Use a secured computer profile and clear drafts before another person uses the profile.
- Browser playback depends on native codec support. Original Opus files remain unchanged even if a particular browser requires a separate research derivative for another tool.
- ZIP extraction currently occurs in memory and must be exercised with the full pilot archive before field use.
- Closing or refreshing the page discards the open in-memory workspace.

Create a production build with `npm run web:build`. The generated `web-dist/` directory is intentionally ignored by Git.
