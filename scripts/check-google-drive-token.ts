import 'dotenv/config';

import { google } from 'googleapis';

import { GOOGLE_DRIVE_READWRITE_SCOPE, OAUTH_REDIRECT_URI, loadOAuthClientSecrets } from './lib/google-oauth-secrets.js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v.trim();
}

/**
 * Debug: confirm the refresh token yields an access token whose scopes include full Drive,
 * and that Drive API responds. Does not modify files.
 */
async function main(): Promise<void> {
  const { clientId, clientSecret } = loadOAuthClientSecrets();
  const refreshToken = requireEnv('GOOGLE_REFRESH_TOKEN');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, OAUTH_REDIRECT_URI);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { token: accessToken } = await oauth2Client.getAccessToken();
  if (!accessToken) {
    throw new Error('No access_token returned (refresh token invalid or revoked?)');
  }

  const tokeninfoUrl = `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`;
  const infoRes = await fetch(tokeninfoUrl);
  const info = (await infoRes.json()) as { scope?: string; error?: string; error_description?: string };

  if (info.error) {
    console.log('tokeninfo error:', info.error, info.error_description ?? '');
  } else if (info.scope) {
    console.log('Active access-token scopes:\n', info.scope.replace(/ /g, '\n '), '\n');
    const need = GOOGLE_DRIVE_READWRITE_SCOPE;
    if (!info.scope.split(/\s+/).includes(need)) {
      console.warn(
        `MISSING required scope for rename/move: ${need}\nRevoke app access, run npm run oauth:google-drive again, replace GOOGLE_REFRESH_TOKEN.\n`,
      );
    } else {
      console.log(`OK: token includes ${need}\n`);
    }
  } else {
    console.log('tokeninfo returned no scope field (unexpected)');
  }

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const about = await drive.about.get({ fields: 'user/emailAddress' });
  console.log('drive.about.get OK — signed in as:', about.data.user?.emailAddress ?? '(unknown)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
