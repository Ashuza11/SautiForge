# Local web annotation workflow

## Purpose

The web workspace makes computer-based review faster while preserving SautiForge's offline and data-minimization boundaries. It is a static browser application: there is no backend, account, automatic synchronization, analytics, or dataset upload.

## Implemented workflow

1. Export a consent-filtered **research dataset** ZIP from the Android app and transfer it to the computer through an authorized method.
2. Run `npm run web:dev` and choose the ZIP in the browser.
3. The browser validates the manifest schema, safe relative paths, declared member set, record counts, file sizes, SHA-256 hashes, audio references, and research record schemas before opening the workspace.
4. Work participant by participant. Each speaker shows completed verbatim transcripts against their recording total; selecting a speaker opens their first unfinished recording.
5. Search within that speaker’s recordings, play audio, and inspect frozen prompt context and the latest transcript.
6. Edit verbatim and normalized text, language tags, notes, scenario/example context, researcher code, workflow status, and structured business labels. Source values are prefilled but remain editable. Verbatim text preserves the words actually spoken; free-text structured labels should use one project-wide canonical vocabulary (English is recommended for the pilot).
7. Use **Save draft and stay** for incomplete work, or **Save & continue** to verify the draft and advance to the next unfinished recording. When a speaker is complete, the workspace marks them done and moves to the next unfinished speaker.
8. Download an annotated ZIP. SautiForge creates human revision records, retains the original audio bytes, rebuilds portable metadata and all member hashes, reopens and validates the generated archive, and reports its archive SHA-256 before reporting success.

After a ZIP passes validation, the workspace retains a copy in this browser’s IndexedDB and revalidates it when the page is opened again. **Close & forget ZIP** removes that retained archive. Local annotation drafts are deliberately stored separately and remain until explicitly cleared.

Private administrative backups are deliberately rejected. The selected archive remains in browser memory and is not modified. Keep the original ZIP and its checksum as the authoritative recovery copy.

## Current limitations

- Only explicitly saved local drafts are included in the annotated export. Unsaved edits are not exported.
- Browser storage is not an encrypted research backup. Use a secured computer profile and clear drafts before another person uses the profile.
- Browser playback depends on native codec support. Original Opus files remain unchanged even if a particular browser requires a separate research derivative for another tool.
- ZIP extraction currently occurs in memory and must be exercised with the full pilot archive before field use.
- Browser storage quotas or privacy modes can prevent the ZIP from being retained. SautiForge reports that condition explicitly; keep the original ZIP and checksum as the authoritative recovery copy.

Create a production build with `npm run web:build`. The generated `web-dist/` directory is intentionally ignored by Git.

## Static hosting

The `Web annotation workspace` workflow builds and deploys `web-dist/` to GitHub Pages. Enable **GitHub Actions** as the Pages source once in repository settings, then use `https://ashuza11.github.io/SautiForge/`. The hosted files contain application code only. Dataset ZIPs, decoded audio, local drafts, and annotated exports are processed by browser APIs and are not workflow artifacts or network uploads.
