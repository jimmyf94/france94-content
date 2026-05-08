import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';

import { OAUTH_REDIRECT_URI, loadOAuthClientSecrets } from './google-oauth-secrets.js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

/** Pull useful detail out of googleapis Gaxios errors (403 reasons, nested messages). */
export function formatGoogleDriveApiError(err: unknown): string {
  if (err == null) return 'unknown error';
  if (typeof err !== 'object') return String(err);

  const e = err as Record<string, unknown>;
  const top = typeof e.message === 'string' ? e.message : '';

  const response = e.response as Record<string, unknown> | undefined;
  const data = response?.data as Record<string, unknown> | undefined;
  const errBody = data?.error as Record<string, unknown> | undefined;
  const nestedMsg = typeof errBody?.message === 'string' ? errBody.message : '';
  const errors = errBody?.errors as Array<Record<string, unknown>> | undefined;

  const parts: string[] = [];
  if (top) parts.push(top);
  if (nestedMsg && nestedMsg !== top) parts.push(nestedMsg);

  if (Array.isArray(errors)) {
    for (const sub of errors) {
      const reason = sub.reason != null ? String(sub.reason) : '';
      const msg = sub.message != null ? String(sub.message) : '';
      const location = sub.location != null ? String(sub.location) : '';
      const bit = [reason, msg, location].filter((s) => s.length > 0).join(' ');
      if (bit) parts.push(bit);
    }
  }

  const uniq = [...new Set(parts)];
  return uniq.length ? uniq.join(' | ') : top || JSON.stringify(err);
}

export async function getDriveClient(): Promise<drive_v3.Drive> {
  const { clientId, clientSecret } = loadOAuthClientSecrets();
  const refreshToken = requireEnv('GOOGLE_REFRESH_TOKEN');
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, OAUTH_REDIRECT_URI);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  await oauth2Client.getAccessToken();
  return google.drive({ version: 'v3', auth: oauth2Client });
}
