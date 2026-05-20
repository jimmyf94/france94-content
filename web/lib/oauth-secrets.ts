import fs from 'node:fs';
import path from 'node:path';

/** Must match GCP OAuth client authorized redirect URIs (Drive OAuth script). */
export const OAUTH_REDIRECT_URI = 'http://127.0.0.1:3333/oauth2callback';

type OAuthClientJson = {
  web?: { client_id?: string; client_secret?: string };
  installed?: { client_id?: string; client_secret?: string };
};

function parseOAuthClientJson(raw: string, sourceLabel: string): { clientId: string; clientSecret: string } {
  let parsed: OAuthClientJson;
  try {
    parsed = JSON.parse(raw) as OAuthClientJson;
  } catch {
    throw new Error(`Invalid OAuth client JSON from ${sourceLabel}: not valid JSON.`);
  }
  const clientId = parsed.web?.client_id?.trim() || parsed.installed?.client_id?.trim();
  const clientSecret =
    parsed.web?.client_secret?.trim() || parsed.installed?.client_secret?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      `Invalid OAuth client JSON from ${sourceLabel}: expected web or installed with client_id and client_secret.`,
    );
  }
  return { clientId, clientSecret };
}

function candidateSecretsPaths(rel: string): string[] {
  if (path.isAbsolute(rel)) return [rel];
  const cwd = process.cwd();
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
      `Cannot read OAuth client secrets file: ${filePath}. Set GOOGLE_OAUTH_CLIENT_SECRETS_JSON (Vercel) or GOOGLE_OAUTH_CLIENT_SECRETS_PATH (e.g. ../f94client.json when cwd is web/).`,
    );
  }
  return parseOAuthClientJson(raw, filePath);
}
