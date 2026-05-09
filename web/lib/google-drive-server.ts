import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';

import { OAUTH_REDIRECT_URI, loadOAuthClientSecrets } from './oauth-secrets';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

export async function getDriveClient(): Promise<drive_v3.Drive> {
  const { clientId, clientSecret } = loadOAuthClientSecrets();
  const refreshToken = requireEnv('GOOGLE_REFRESH_TOKEN');
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, OAUTH_REDIRECT_URI);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  await oauth2Client.getAccessToken();
  return google.drive({ version: 'v3', auth: oauth2Client });
}
