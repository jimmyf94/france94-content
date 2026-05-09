# FR94 post candidate review dashboard (v0.5)

Next.js App Router UI for reviewing `post_candidates` and previewing files copied into each candidate’s Google Drive review folder.

## How to run

From the repository root (after `npm install` at root so workspaces link):

```bash
npm run review:dev
```

Or from `web/`:

```bash
cd web && npm run dev
```

Default URL: [http://127.0.0.1:3040/content/review](http://127.0.0.1:3040/content/review)

Configure environment in `web/.env.local` (see `web/.env.example`). **`next.config.ts` also loads the repository root `.env`**, so the same `SUPABASE_*` and `GOOGLE_*` values as your CLI scripts usually work without copying files.

When OAuth JSON lives at the repo root, set `GOOGLE_OAUTH_CLIENT_SECRETS_PATH` to `../f94client.json` from `web/` or use an absolute path.

Apply the Supabase migration `20260517120000_post_candidates_review_audit.sql` so `reviewed_at` and `reviewed_by` exist before relying on PATCH updates.

## Optional access gate

If `REVIEW_DASHBOARD_SECRET` is set, the middleware requires either:

- `Authorization: Bearer <secret>` or `x-review-secret: <secret>` on API calls, or  
- an HTTP-only cookie set via **POST** `/api/content-review/unlock` with JSON `{ "secret": "..." }`.

Browse to `/content/review/unlock` once to enter the secret (or open that page from the link on the review screen).

## API routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/content-review/candidates` | List/filter candidates (Supabase). |
| PATCH | `/api/content-review/candidates/[id]` | Set `approved` / `rejected` / `needs_rewrite` + notes. |
| GET | `/api/content-review/candidates/[id]/files` | List files in `review_drive_folder_id`. |
| GET | `/api/content-review/drive-file/[fileId]?candidateId=` | Stream file bytes after parent-folder check; forwards `Range` when supported. |
| POST | `/api/content-review/unlock` | Set session cookie when `REVIEW_DASHBOARD_SECRET` is configured. |
| POST | `/api/content-review/logout` | Clear session cookie. |

## Video streaming vs fallback

- The UI uses `<video src={/api/content-review/drive-file/...}>` when MIME type is video. The route proxies Google Drive `alt=media` and forwards the browser `Range` header when Drive returns partial content.
- If playback fails (codec, Range, or Drive errors), the tile falls back to a Drive thumbnail (if present) plus **Open in Drive**.

## Known limitations

- Drive **thumbnail URLs** may expire or return 403 for some accounts; images then retry via the proxy URL.
- **Safari and mobile** browsers can be stricter about video ranges and codecs; Drive **webViewLink** remains the reliable fallback.
- The dashboard does **not** implement Supabase end-user auth; protect it with network access control, the optional shared secret, or both.
