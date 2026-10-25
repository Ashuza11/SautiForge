# Authorized master-media ingestion

Batch 4 adds a server-owned upload lifecycle for permission-cleared audio and video masters. It does not download media from YouTube or another URL, expose the bucket publicly, segment files, or make the current GitHub Pages application a remote administration client.

## Safety gates

A master upload can start only when all of the following are true:

1. The source belongs to an active project and its target language has been verified.
2. The latest append-only rights decision is `approved`.
3. That exact rights revision authorizes `internalProcessing`.
4. The client supplies a safe display filename, an `audio/*` or `video/*` media type, an exact byte count, a hexadecimal SHA-256 digest, and a pseudonymous administrator code.

The API generates the object key; client filenames never become storage paths. The pending database record retains the exact rights revision that authorized ingestion.

## Upload protocol

1. Register and approve the source through the [source catalogue](SOURCE_CATALOGUE.md).
2. Hash the authorized file locally and call `POST /v1/admin/sources/:sourceId/media/uploads`.
3. Upload the original bytes with `PUT` to the returned short-lived URL. Send every returned header exactly. A browser supplies `Content-Length` automatically from the request body; JavaScript must not try to set that forbidden header.
4. Call `POST /v1/admin/source-media/:mediaId/complete`.
5. The service issues a checksum-enabled object metadata request and compares the stored byte count, media type, SHA-256, and server-side encryption state with the pending record.
6. Only an exact match becomes `verified`. Missing objects remain pending and can be retried. A mismatch becomes `verification_failed`; start a new upload rather than overwriting its audit record.

The completion operation is idempotent for an already verified record. A database-side permission join is repeated both when the pending record is created and when verification is saved, preventing a concurrent rights revocation from producing a newly verified master.

## Administration endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/admin/sources/:sourceId/media` | List all master upload attempts for a source |
| `POST` | `/v1/admin/sources/:sourceId/media/uploads` | Create a rights-bound pending record and short-lived upload URL |
| `POST` | `/v1/admin/source-media/:mediaId/complete` | Verify the uploaded object and persist its result |

All routes require the temporary administrator bearer boundary. The upload URL authorizes only one generated object key for a short period; it is not a bucket credential.

## Private bucket requirements

- Enable Block Public Access and reject public bucket policies.
- Keep server-side encryption enabled. The signed request currently requires S3 `AES256`; completion also accepts an observed `aws:kms` encryption state.
- Grant the service identity only the bucket actions required for readiness, signed `PutObject`, `HeadObject`, and future restricted `GetObject` access.
- Configure bucket CORS only for the deployed administration origin, `PUT`, and the returned `content-type`, `x-amz-checksum-sha256`, and `x-amz-server-side-encryption` headers.
- Do not put AWS credentials, the administrator token, or Neon credentials in Expo, Vite, GitHub Pages, or repository files.

## Current limitations

- No administration screen calls these APIs because a browser-safe scoped administrator session is not implemented. Use API tooling only in a controlled development environment.
- Real Neon migration, real S3 CORS/IAM, a large authorized upload, restart/retry, and an independent re-hash remain deployment acceptance tests.
- Pending upload expiry/orphan cleanup, withdrawal-driven object quarantine/deletion, multipart upload, download authorization, media inspection with FFmpeg, and segmentation are later batches.
- A verified storage record describes file integrity, not continuing permission. Every downstream operation must re-check the current source rights.
