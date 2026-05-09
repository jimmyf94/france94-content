import fs from 'node:fs';
import path from 'node:path';

/** Must match GCP OAuth client authorized redirect URIs (Drive OAuth script). */
export const OAUTH_REDIRECT_URI = 'http://127.0.0.1:3333/oauth2callback';

type OAuthClientJson = {
  web?: { client_id?: string; client_secret?: string };
  installed?: { client_id?: string; client_secret?: string };
};

export function oauthClientSecretsPath(): string {
  const fromEnv = process.env.GOOGLE_OAUTH_CLIENT_SECRETS_PATH?.trim();
  const rel = fromEnv || 'f94client.json';
  return path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
}

export function loadOAuthClientSecrets(): { clientId: string; clientSecret: string } {
  const filePath = oauthClientSecretsPath();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(
      `Cannot read OAuth client secrets file: ${filePath}. Set GOOGLE_OAUTH_CLIENT_SECRETS_PATH (e.g. ../f94client.json when dev server cwd is web/).`,
    );
  }
  const parsed = JSON.parse(raw) as OAuthClientJson;
  const clientId = parsed.web?.client_id?.trim() || parsed.installed?.client_id?.trim();
  const clientSecret =
    parsed.web?.client_secret?.trim() || parsed.installed?.client_secret?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      `Invalid OAuth client JSON at ${filePath}: expected web or installed with client_id and client_secret.`,
    );
  }
  return { clientId, clientSecret };
}
