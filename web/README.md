# FR94 post candidate review dashboard (v0.5)

Next.js App Router UI for reviewing `post_candidates` and previewing files copied into each candidate’s Google Drive review folder.

## Environment (single file)

All configuration lives in the **repository root** `.env` (see `.env.example`).

- Local: copy `.env.example` → `.env` and fill in values.
- **`next.config.ts` loads the repo-root `.env`** when you run the app from `web/`, so you do not need a second env file.
- **Vercel:** set the same variables in the project dashboard (Production + Preview). Use **Root Directory = `web`**. For Google OAuth, set `GOOGLE_OAUTH_CLIENT_SECRETS_JSON` to the full JSON from GCP (instead of committing `f94client.json`).
- **GitHub Actions (auto-ingest):** add the same keys as [repository secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) listed in `.github/workflows/auto-ingest.yml`.

When OAuth JSON lives at the repo root locally, `GOOGLE_OAUTH_CLIENT_SECRETS_PATH=f94client.json` is enough.

Apply Supabase migrations under `supabase/migrations/`, including:

- `20260517120000_post_candidates_review_audit.sql` — `reviewed_at`, `reviewed_by`
- `20260513120000_pipeline_settings.sql` — auto-ingest toggle + last-run status

For **Regenerate Candidate** (v0.6), ensure `post_candidates` has regeneration columns (see SQL in prior README sections).

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

## Deploy to Vercel (Hobby)

1. Import the GitHub repo in Vercel.
2. **Root Directory:** `web`
3. **Build command:** `npm run build` (default for Next.js)
4. **Environment variables:** copy from `.env.example` (same names as local). Required minimum: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_OAUTH_CLIENT_SECRETS_JSON`, `GEMINI_API_KEY`, and any vars your API routes use (Instagram, public media bucket, etc.).
5. Auth: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ALLOWED_EMAILS` (Google OAuth via Supabase).

Heavy workers (auto-ingest pipeline, reel render, publishing prep) run **outside** Vercel — see auto-ingest below.

## Auto-ingest (Drive → post suggestions)

1. Drop files in the Drive inbox folder (`GOOGLE_DRIVE_FOLDER_ID`).
2. In the app: **LLM settings** → **Auto-ingest** → turn **On** and set the pause threshold (default: pause when ≥ 5 candidates are `needs_review`).
3. GitHub Actions runs `npm run auto:ingest-tick` every 30 minutes (workflow `.github/workflows/auto-ingest.yml`). The tick no-ops when auto-ingest is off or the queue is full.
4. When paused, review candidates and turn auto-ingest back on from settings.

Local test (uses root `.env`):

```bash
npm run auto:ingest-tick
```

## Access (Google sign-in)

Protected routes require a Supabase session from **Google OAuth**:

1. Supabase dashboard → Authentication → Providers → **Google** (Client ID + Secret from Google Cloud).
2. Google Cloud OAuth client → authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Supabase → Authentication → URL Configuration → add `http://localhost:3040/auth/callback` and your production `/auth/callback` URL.
4. Set `ALLOWED_EMAILS` (comma-separated) in `.env` — only those Google accounts can use the app.

Sign in at `/login`. Sign out from the review header (clears session).

## API routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/content-review/candidates` | List/filter candidates (Supabase). |
| PATCH | `/api/content-review/candidates/[id]` | Set `approved` / `rejected` / `needs_rewrite` + notes. |
| POST | `/api/content-review/candidates/[id]/regenerate` | Re-run planner LLM in place. |
| GET/PATCH | `/api/content-review/pipeline` | Auto-ingest toggle, threshold, last-run status. |
| GET | `/api/content-review/candidates/[id]/files` | List files in `review_drive_folder_id`. |
| GET | `/api/content-review/drive-file/[fileId]?candidateId=` | Stream file bytes after parent-folder check. |
| POST | `/api/auth/signout` | Clear Supabase session cookies. |

## Video streaming vs fallback

- The UI uses `<video src={/api/content-review/drive-file/...}>` when MIME type is video. The route proxies Google Drive `alt=media` and forwards the browser `Range` header when Drive returns partial content.
- If playback fails, the tile falls back to a Drive thumbnail plus **Open in Drive**.

## Known limitations

- Drive thumbnail URLs may expire or return 403; images then retry via the proxy URL.
- Safari/mobile can be stricter about video ranges and codecs; Drive `webViewLink` remains the reliable fallback.
- Access is limited to emails in `ALLOWED_EMAILS`; API routes still use the service role for data (not per-user RLS).
