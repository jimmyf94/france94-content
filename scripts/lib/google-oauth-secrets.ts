import fs from 'node:fs';
import path from 'node:path';

/**
 * Must match an authorized redirect URI on the OAuth client (Web or Desktop) in GCP:
 * APIs & Services → Credentials → your OAuth 2.0 Client ID → Authorized redirect URIs.
 */
export const OAUTH_REDIRECT_URI = 'http://127.0.0.1:3333/oauth2callback';

/** List + download only (ingest/analyze work with this; rename/move does not). */
export const GOOGLE_DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** Full file access: required for `files.update` (rename, change parents). Narrower scopes do not cover arbitrary files in shared folders. */
export const GOOGLE_DRIVE_READWRITE_SCOPE = 'https://www.googleapis.com/auth/drive';

type OAuthClientJson = {
  web?: {
    client_id?: string;
    client_secret?: string;
  };
  /** "Desktop app" client download JSON uses `installed`. */
  installed?: {
    client_id?: string;
    client_secret?: string;
  };
};

function parseOAuthClientJson(raw: string, sourceLabel: string): { clientId: string; clientSecret: string } {
  let parsed: OAuthClientJson;
  try {
    parsed = JSON.parse(raw) as OAuthClientJson;
  } catch {
    throw new Error(`Invalid OAuth client JSON from ${sourceLabel}: not valid JSON.`);
  }
  const clientId =
    parsed.web?.client_id?.trim() || parsed.installed?.client_id?.trim();
  const clientSecret =
    parsed.web?.client_secret?.trim() || parsed.installed?.client_secret?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      `Invalid OAuth client JSON from ${sourceLabel}: expected a "web" or "installed" object with client_id and client_secret.`,
    );
  }
  return { clientId, clientSecret };
}

function candidateSecretsPaths(rel: string): string[] {
  if (path.isAbsolute(rel)) return [rel];
  const cwd = process.cwd();
  // Try cwd first, then walk up two parents so the same relative path
  // (e.g. `f94client.json` at repo root) resolves whether cwd is the repo root,
  // `web/` (Next dev/build), or `scripts/`.
  return [
    path.resolve(cwd, rel),
    path.resolve(cwd, '..', rel),
    path.resolve(cwd, '..', '..', rel),
  ];
}

export function oauthClientSecretsPath(): string {
  const fromEnv = process.env.GOOGLE_OAUTH_CLIENT_SECRETS_PATH?.trim();
  const rel = fromEnv || 'f94client.json';
  for (const candidate of candidateSecretsPaths(rel)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidateSecretsPaths(rel)[0];
}

/** Load OAuth client id/secret from env JSON or a GCP "Web client" / "Desktop app" JSON file. */
export function loadOAuthClientSecrets(): { clientId: string; clientSecret: string } {
  const fromEnvJson = process.env.GOOGLE_OAUTH_CLIENT_SECRETS_JSON?.trim();
  if (fromEnvJson) {
    return parseOAuthClientJson(fromEnvJson, 'GOOGLE_OAUTH_CLIENT_SECRETS_JSON');
  }

  const filePath = oauthClientSecretsPath();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(
      `Cannot read OAuth client secrets file: ${filePath}. Set GOOGLE_OAUTH_CLIENT_SECRETS_JSON (Vercel/GHA) or GOOGLE_OAUTH_CLIENT_SECRETS_PATH / f94client.json at the repo root.`,
    );
  }
  return parseOAuthClientJson(raw, filePath);
}

/** @deprecated Use {@link loadOAuthClientSecrets} (same behavior; supports Desktop JSON too). */
export function loadWebOAuthClientSecrets(): { clientId: string; clientSecret: string } {
  return loadOAuthClientSecrets();
}
