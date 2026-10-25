# External source catalogue and rights workflow

The source catalogue is the Batch 3 safety gate between discovering media and processing it. It is reusable across languages and projects. A catalogue record is metadata only: registering a YouTube or other URL does not download, copy, approve, or publish that media.

## Administrative workflow

1. Register a source candidate under an active project. URL-based sources require the original discovery URL; existing SautiForge recordings require their stable recording reference.
2. Verify the language independently. Use `verified_target` only after project language reviewers confirm the intended language/variety; use `mixed_target` when the target language is genuinely present with other speech. `wrong_language` rejects the candidate.
3. Record speaker-identification status separately. A publisher, sender, creator, or rights holder is not automatically the person speaking.
4. Identify the rights holder and retain a restricted reference to the evidence. Do not put private contracts or personal contact data in a public field.
5. Add a rights revision specifying each permitted use independently: internal processing, volunteer access, transcription, ML research, and public audio distribution.
6. Approval is accepted only when the target language is verified and the revision contains a rights holder, permission evidence, and at least one allowed use.
7. Add a new rejected or revoked revision when permission is refused or withdrawn. Earlier revisions remain intact, while all future use checks fail immediately.

Metadata updates use the current rights revision as an optimistic lock. If language review and a permission decision occur concurrently, the later writer receives `source_changed` and must reload; it cannot overwrite a revocation or approve stale language metadata.

The initial Mashi discovery URLs are stored in `server/fixtures/mashi-source-candidates.json`. All four are explicitly unverified candidates. They are not inserted automatically because the service needs the real Mashi project UUID and an administrator must review current metadata before registration.

## Status meanings

| Status | Meaning |
| --- | --- |
| `candidate` | Discovered metadata only; no processing permission is implied |
| `language_unverified` | Reviewed but the target language has not been confirmed |
| `permission_pending` | Target language confirmed; applicable rights are not approved |
| `approved` | Language and at least one evidence-backed use are approved |
| `rejected` | Wrong language or rights rejected; excluded from normal lists |
| `revoked` | Previously approved permission was withdrawn; every use is blocked |

## Protected API

All routes require the temporary administrator bearer token and the configured web origin.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/v1/admin/projects/:projectId/sources` | List usable catalogue records; `?includeInactive=true` includes rejected/revoked records |
| `POST` | `/v1/admin/projects/:projectId/sources` | Register a metadata-only candidate |
| `GET` | `/v1/admin/sources/:sourceId` | Read source metadata and its current rights revision |
| `PUT` | `/v1/admin/sources/:sourceId` | Update language, speaker, and descriptive metadata |
| `GET` | `/v1/admin/sources/:sourceId/rights` | Read the complete chronological rights history |
| `POST` | `/v1/admin/sources/:sourceId/rights` | Append a permission decision; never overwrites previous decisions |

There is deliberately no media upload, YouTube download, task sharing, public source endpoint, or delete endpoint in this batch. The next media-ingestion batch must call the service's use-specific authorization gate before issuing an upload URL or creating a clip.
