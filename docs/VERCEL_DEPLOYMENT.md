# Deploying to Vercel

The web app and the API are served from one Vercel project on one origin, so the admin session cookie stays first-party.

- `vercel.json` builds the web app (`npm run web:build`, output `web-dist`) and rewrites `/health` and `/v1/*` to a single function.
- `api/index.ts` is that function. It builds the server on the first request. If a setting is missing it answers `503 server_not_configured` and logs the reason in the Vercel function logs; it never returns the reason to the caller.
- One function keeps the project under the Hobby limit of 12 functions.

## Environment variables

Set these in the Vercel project (Production and Preview). Never commit them.

| Name | Notes |
| --- | --- |
| `NODE_ENV` | `production` (marks the session cookie `Secure`) |
| `WEB_ORIGIN` | The exact site origin, for example `https://sautiforge.vercel.app`, no trailing slash |
| `DATABASE_URL` | Neon pooled connection string with `sslmode=require` |
| `AWS_REGION`, `S3_BUCKET` | Private bucket (Neon Object Storage: the region Neon shows, for example `eu-central-1`) |
| `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | Neon's storage endpoint (`AWS_ENDPOINT_URL_S3`) and `true`; Neon requires path-style addressing. Leave both out for AWS S3 |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Neon storage credential (`neon env pull --service object-storage` writes them) or keys limited to the bucket |
| `ADMIN_API_TOKEN` | 32+ random characters, for scripts such as `publish` |
| `ADMIN_PASSWORD`, `SESSION_SECRET` | Admin login; 12+ and 32+ characters |

Neon endpoints (host ending `.neon.tech`) are detected automatically: Neon accepts the checksum and encryption headers but does not report encryption back, so only that one check is skipped. On AWS S3 the bucket needs a CORS rule that allows `PUT` and `GET` from `WEB_ORIGIN` if browsers upload directly.

If a setting is wrong, `/health` answers `503 {"error":"server_not_configured","invalid_settings":["WEB_ORIGIN"]}` with the names only, never the values.

## Steps

1. Apply the database migrations once: `npm run server:migrate:local` with `server/.env` pointing at Neon.
2. Import the repository in Vercel (or run `vercel deploy`), then add the variables above.
3. Open `/health` (should return `{"status":"ok"}`), then sign in and check `/v1/admin/ready`.

## Known limits

- The login lockout counter lives in function memory, so it slows guessing but is not a hard limit across instances.
- The deployed site cannot be tested from this repository without your Neon, S3 and Vercel accounts.
