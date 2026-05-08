import fs from 'node:fs';
import path from 'node:path';

/** Must match Authorized redirect URI in GCP (OAuth Web client). */
export const OAUTH_REDIRECT_URI = 'http://127.0.0.1:3333/oauth2callback';

export const GOOGLE_DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

type WebClientJson = {
  web?: {
    client_id?: string;
    client_secret?: string;
  };
};

export function oauthClientSecretsPath(): string {
  const fromEnv = process.env.GOOGLE_OAUTH_CLIENT_SECRETS_PATH?.trim();
  const rel = fromEnv || 'f94client.json';
  return path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
}

export function loadWebOAuthClientSecrets(): { clientId: string; clientSecret: string } {
  const filePath = oauthClientSecretsPath();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(
      `Cannot read OAuth client secrets file: ${filePath}. Set GOOGLE_OAUTH_CLIENT_SECRETS_PATH or add f94client.json at the repo root.`,
    );
  }
  const parsed = JSON.parse(raw) as WebClientJson;
  const clientId = parsed.web?.client_id?.trim();
  const clientSecret = parsed.web?.client_secret?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      `Invalid OAuth client JSON at ${filePath}: expected { "web": { "client_id", "client_secret" } }.`,
    );
  }
  return { clientId, clientSecret };
}
