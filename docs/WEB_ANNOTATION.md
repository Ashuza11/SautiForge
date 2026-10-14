# Local web annotation workflow

## Purpose

The web workspace makes computer-based review faster while preserving SautiForge's offline and data-minimization boundaries. It is a static browser application: there is no backend, account, automatic synchronization, analytics, or dataset upload.

## Implemented first slice

1. Export a consent-filtered **research dataset** ZIP from the Android app and transfer it to the computer through an authorized method.
2. Run `npm run web:dev` and choose the ZIP in the browser.
3. The browser validates the manifest schema, safe relative paths, declared member set, record counts, file sizes, SHA-256 hashes, audio references, and research record schemas before opening the workspace.
4. Search by recording ID, pseudonymous speaker code, scenario, language, or annotation status; play audio and inspect frozen prompt context and the latest transcript.

Private administrative backups are deliberately rejected. The selected archive remains in browser memory and is not modified. Keep the original ZIP and its checksum as the authoritative recovery copy.

## Current limitations

- This slice is read-only. Transcript and annotation editing, durable browser drafts, and enriched dataset export are not yet implemented.
- Browser playback depends on native codec support. Original Opus files remain unchanged even if a particular browser requires a separate research derivative for another tool.
- ZIP extraction currently occurs in memory and must be exercised with the full pilot archive before field use.
- Closing or refreshing the page discards the open in-memory workspace.

Create a production build with `npm run web:build`. The generated `web-dist/` directory is intentionally ignored by Git.
