# Community service foundation

Batch 2 adds a small, separate Node.js service for future remote administration and community annotation. The Android application remains offline-first, and the static GitHub Pages workspace still processes research ZIPs locally. Neither client contains Neon, AWS, or administrator credentials.

## Implemented boundary

- Hono HTTP service with a public liveness endpoint and protected administration endpoints.
- Shared Zod project contract, so the API accepts the same language-independent project fields as Android and the web project editor.
- Neon/PostgreSQL project repository with parameterized SQL, soft archival, UTC-normalized ISO 8601 timestamps, and an explicit migration.
- Private S3-compatible storage adapter with bucket readiness checks and short-lived upload/download signing. Upload signatures bind the media type, byte size, base64 SHA-256 checksum, and server-side encryption request.
- Exact-origin CORS checks, a 64 KiB administration-request limit, and a temporary administrator bearer token boundary.
- Readiness checks that verify the database and bucket without returning hostnames, credentials, or provider errors to the caller.

The API is not yet connected to the public web page. Putting `ADMIN_API_TOKEN` in Vite or Expo configuration would expose it to every user. A later batch must add scoped administrator sessions before the web administration screen uses these endpoints.

No source catalogue, rights approval, media upload route, segmentation, contributor invite, remote annotation, or review workflow is implemented in this batch.

## Local configuration

Prerequisites are Node.js 22+, a Neon PostgreSQL database, and a private AWS S3 bucket (or a compatible private object store). Copy `server/.env.example` to the ignored `server/.env` and replace every placeholder.

Use Neon's pooled connection string with TLS. Configure the S3 bucket with Block Public Access enabled and do not add a public bucket policy. In deployed AWS environments, prefer an IAM role; only set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` for local development when necessary. The credentials need only the future application's scoped bucket actions—not account-wide S3 access.

Load local variables using Node's environment-file support, then run the migration and service:

```bash
npm run server:migrate:local
npm run server:start:local
```

Production hosts should inject the same variables through their secret manager instead of an environment file. Never commit `server/.env`.

## Endpoints

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | Public | Process liveness only |
| `GET` | `/v1/admin/ready` | Admin bearer token | Database and private-bucket readiness without provider details |
| `GET` | `/v1/admin/projects` | Admin bearer token | List active projects; `?includeArchived=true` includes archived projects |
| `POST` | `/v1/admin/projects` | Admin bearer token | Create a validated project with a server-generated UUID and timestamps |
| `PUT` | `/v1/admin/projects/:projectId` | Admin bearer token | Replace editable project fields while preserving identity and creation time |
| `POST` | `/v1/admin/projects/:projectId/archive` | Admin bearer token | Soft-archive a project |

Example readiness request:

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" http://127.0.0.1:8787/v1/admin/ready
```

## Migration safety

`npm run server:migrate` creates `schema_migrations`, checks each migration's SHA-256, and refuses to continue if an already-applied migration was edited. Create a new numbered migration rather than changing an applied file. The first migration deliberately creates only `projects`; source and task tables will be introduced alongside their permission and lifecycle rules.

Before migrating a non-empty environment, take a provider backup or branch. Migration execution against a real Neon project remains a deployment acceptance test because repository tests use controlled doubles and do not contain live credentials.

## Verification

Run:

```bash
npm run typecheck
npm test
npm run web:build
```

Automated tests cover environment validation, credential pairing, administrator authorization, exact-origin handling, project CRUD/archive behavior, parameterized Neon queries and persisted-row validation, migration constraints, storage key/checksum/expiry rules, and readiness failure behavior. A real Neon connection, real private bucket, IAM policy, deployed TLS endpoint, and browser-to-service administrator session are not yet verified.
