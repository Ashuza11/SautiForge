# Community speech data collection V2

## Repository audit (verified 2026-10-22)

Facts in this section were verified from the repository and automated tests. Recommendations are labelled separately.

| Existing component | Current implementation | Reuse approach | Required changes |
| --- | --- | --- | --- |
| Android client | Expo SDK 57, React Native, Expo Router, TypeScript | Keep the field workflow and existing screens | Add only project/source capabilities needed by proven pilots |
| Local data | `expo-sqlite`, schema version 8, foreign keys, migrations, repository interfaces | Continue using stable UUIDs and repository boundaries | Future external-source/clip records need safe migrations after their workflow is specified |
| Audio storage | Verified files in app document storage; metadata in SQLite | Keep direct recording and imported voice notes unchanged | External long-media masters belong in web/server storage, not Android SQLite |
| Direct recording | Real `expo-audio` microphone capture, playback, verified accept/save, recovery checks | Preserve as collection path A | Physical-device regression tests remain required |
| WhatsApp collection | Researcher shares scenario examples manually; returned files are selected with Android's document picker, played, explicitly matched, hashed, and saved | Preserve as collection path B and reliable fallback | A future Android share target may reduce picker friction; private WhatsApp directories must not be scanned automatically |
| Participants and consent | Pseudonymous participants, append-only consent revisions, per-use export gates; server-side third-party source rights are now separate append-only records | Reuse consent for participant speech and source rights for external media | Future media/clip records must retain the applicable rights revision |
| Sessions and scenarios | Project-scoped, resumable sessions and versioned scenario snapshots | Reuse for Android recordings and short authorized imports | Long source material needs clips, not artificial participant sessions |
| Recording provenance | Android captures source, transport, prompt exposure, import time, MIME type, SHA-256, submission code, and frozen prompt; the server has normalized source/rights records and verified private master metadata | Reuse Android provenance and derive future clips only from authorized verified masters | Clip offsets are not implemented |
| Android annotation | Revisioned human transcription and schema-versioned annotations | Keep for offline review | Project annotation profile now prevents Mashi from requiring Kingwana business fields |
| Web administration and annotation | Static React/Vite page remains local-only; protected server APIs now persist projects and source rights but are not connected to the page | Reuse the shared schemas and add a scoped admin session before connecting the UI | No source-admin UI, task assignment, independent submissions, or reviewer accounts exist |
| Android/web relationship | Verified research ZIP export/import bridge only | Keep this transitional boundary for the first Mashi pilot slice | Optional synchronization should be evidence-driven, not added before the community service is proven |
| Browser persistence | ZIP in IndexedDB; per-recording drafts in local storage, both source-manifest-bound | Reuse for researcher mode and failed-edit recovery | It is neither encrypted backup nor safe multi-user remote storage |
| Export | Consent-filtered JSON/JSONL/CSV, original audio, stable IDs, sizes and SHA-256; strict Zod validation and ZIP revalidation | Extend compatibly | Schema 1.4 adds project language code and annotation profile |
| Backup/restore | Separate sensitive SQLite/audio archive with preflight, hash, integrity, foreign-key, and rollback checks | Preserve for Android administration | It must not be accepted by the public/community web workflow |
| Backend and accounts | A separate Hono service now provides protected project/source/master APIs, Neon migrations, a private S3-compatible storage boundary, and readiness checks; it is not connected to the public web client | Reuse this server boundary for segmentation and later task sessions | Scoped admin/contributor sessions, task records, and a deployed service are still required |
| Deployment | Standalone APK GitHub Action and static GitHub Pages workflow | Continue both | A community service will need a separate deployment and threat review |
| Automated tests | Type/domain/migration/repository/export/web tests using Vitest and Node SQLite | Extend with each slice | Native microphone, document-provider, browser/device, and field tests remain manual acceptance gates |

## Implemented V2 slices

This slice keeps the existing ZIP bridge and makes it project-aware:

- SQLite migration 8 adds a required ISO 639-3 language code and an explicit `business_transaction` or `verbatim_transcription` annotation profile.
- The editable `Mashi Community Speech Pilot` is added with `Shi`, `Mashi`, and the correct ISO 639-3 code `shr`. It is not made the active project automatically.
- An initial generic scenario permits testing with a permission-cleared short speech sample. It does not authorize media by itself.
- Android project create/edit screens expose both configuration fields.
- The web administration screen creates, edits and archives projects for any language using the same project schema, verifies local persistence, and downloads a portable configuration. Its repository is local until the backend batch introduces Neon.
- Research export schema 1.4 carries this configuration while still accepting 1.0–1.3 archives.
- The web workspace keeps the Kingwana label editor for business projects. For general verbatim projects it hides business labels, labels notes as language-variant notes, and never generates a `business.transaction` annotation.
- General transcription projects do not copy an elicitation example or source description into verbatim text. A human must enter what was actually spoken.
- Annotated ZIPs still preserve original audio, revisions, stable IDs, sizes, hashes, and post-build verification.

This is a usable transitional flow:

```text
permission-cleared short Mashi audio
  -> manual Android recording/import and consent metadata
  -> verified restricted-annotation ZIP
  -> profile-aware local web transcription
  -> verified annotated ZIP
```

It is not yet the remote two-annotator community workflow.

The second slice adds the server foundation without changing that working bridge:

- A real Node/Hono API owns validation, IDs, timestamps, project persistence, and infrastructure readiness.
- A Neon/PostgreSQL migration represents reusable projects without embedding a particular language.
- A private S3-compatible adapter can create short-lived, checksummed, encrypted upload/download URLs, but no public media route exists before source rights are modeled.
- Secrets remain server-only. GitHub Pages and the Expo bundle do not receive the database URL, object-storage credentials, or administrator token.
- Protected project endpoints use a temporary administrator bearer token. The browser remains local-only until scoped administrator sessions are added.

The third slice adds a reusable external-source and permission catalogue:

- Candidate URLs, creator-provided files, authorized uploads, existing SautiForge recordings, and other references share one project-scoped source contract.
- Language verification, speaker identification, creator, and rights holder remain distinct; the sender or publisher is never silently treated as the speaker.
- Permission decisions are append-only revisions with separate gates for internal processing, volunteer access, transcription, ML research, and public distribution.
- Approval requires target-language verification, a rights holder, permission evidence, and at least one explicit use. Rejection and revocation block use without erasing history.
- The four researcher-provided Mashi discovery URLs are retained as unverified candidate templates only. Nothing downloads or approves them automatically.

The fourth slice adds controlled original-master ingestion:

- Only the latest approved rights revision with `internalProcessing` can initiate an upload.
- The server generates a private object key and returns a short-lived URL whose request binds media type, byte size, SHA-256, and encryption.
- A source-media record retains the exact authorizing rights revision and never stores audio bytes in Neon.
- Completion independently reads object metadata and marks the master verified only when size, type, checksum, and encryption all match.
- Database-side authorization is repeated at creation and completion so a concurrent revocation fails closed.
- Candidate URLs are still metadata only. No YouTube or third-party stream is downloaded.

## Recommended target architecture (not yet implemented)

```text
Android direct recording ----+
Android WhatsApp import ------+--> portable project/recording/annotation contracts --> verified releases
Authorized web source/clip ---+
                                      ^
                                      |
                       small community task service
                  protected media + scoped invite sessions
                   independent submissions + review
```

Keep Android offline and keep ZIP interchange. Add one small modular service only when remote volunteers are introduced. A practical low-cost deployment can use a single relational database, private S3-compatible object storage, expiring media URLs, and a small API/web application. It does not require microservices, a paid WhatsApp API, Firebase, or Android cloud synchronization.

The service must distinguish speaker, annotator, reviewer, and rights holder. Raw submissions must be append-only; final reviewed text must be a separate decision. Annotator B must not receive annotator A's text before submitting. Public links must identify only a scoped batch and must not grant source-library or dataset access.

## Smallest safe implementation plan

1. **Completed:** project-aware Mashi transcription profile through Android configuration, reusable web project creation, ZIP interchange, web editing, and verified derivative export.
2. **Completed in Batch 2:** introduce the small API, Neon project repository/migration, private S3-compatible adapter, and server-side permission boundary without changing the Android offline workflow.
3. **Completed in Batch 3:** add protected source catalogue records with language/speaker verification, append-only rights decisions, and explicit rights-by-use states. Candidate URLs remain unapproved metadata.
4. **Completed in Batch 4:** add permission-gated original-master upload with private generated keys, exact rights-revision provenance, and post-upload integrity verification.
5. **Next:** add manual 8–30 second segmentation with exact offsets, derived clip hashes, and human boundary adjustment. FFmpeg runs on the administration computer or service, not on the Android recorder.
6. Add scoped invites, pseudonymous contributor sessions, 5–10 clip batches, draft/retry/duplicate protection, and protected audio delivery.
7. Add two independent submissions, reviewer comparison, character-level difference display, adjudication, and final transcript records without overwriting raw annotations.
8. Extend verified export with source rights references, clip offsets, review status, variant notes, and source/speaker-grouped split guidance.

## Security and compatibility decisions

- Manual WhatsApp sharing/import remains supported and no private chat or media directory is scanned.
- Candidate YouTube, film, Bible, or creator URLs are discovery metadata only; SautiForge must not download streams or imply permission.
- Rights must be checked separately for internal processing, volunteer access, transcription, ML research, and public distribution.
- A source description, subtitle, scenario, or prompt is not a verified transcript.
- The original Kingwana schema and 1.0–1.3 archives remain readable. Schema 1.4 is additive.
- GitHub Pages is suitable for the current local ZIP tool, but not for protected shared tasks because it provides no server-side authorization or storage.

## Remaining limitations

- The external-source, rights, and master-ingestion APIs exist, but no FFmpeg pipeline, segmentation editor, clip entity, or voice-activity detection exists yet.
- No source/master administration UI exists, and real private-bucket upload verification remains a deployment acceptance test.
- The API foundation exists locally, but it is not deployed or connected to the public web client. No scoped admin session, remote contributor identity, invite, task claim, segmentation route, independent annotation, reviewer queue, or adjudication exists.
- Web-created projects currently remain in verified local browser storage and portable JSON. The Neon project API exists, but connecting it safely requires scoped administrator authentication rather than exposing the server token in JavaScript.
- The Mashi seed scenario supports only the current short-audio bridge; it is not a substitute for source-rights records.
- No listed external Mashi source has been language-verified or permission-approved by this code change.
- Full Android regression, real Mashi audio, browser compatibility, and five-clip end-to-end community testing remain manual gates.
