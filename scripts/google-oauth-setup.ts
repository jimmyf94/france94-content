import 'dotenv/config';

import { execFile } from 'node:child_process';
import http from 'node:http';
import { URL } from 'node:url';

import { google } from 'googleapis';

import {
  GOOGLE_DRIVE_READONLY_SCOPE,
  OAUTH_REDIRECT_URI,
  loadWebOAuthClientSecrets,
} from './lib/google-oauth-secrets.js';

const CALLBACK_PATH = '/oauth2callback';
const PORT = 3333;

function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === 'darwin') {
    execFile('open', [url], () => {});
  } else if (platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], () => {});
  } else {
    execFile('xdg-open', [url], () => {});
  }
}

async function main(): Promise<void> {
  const { clientId, clientSecret } = loadWebOAuthClientSecrets();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, OAUTH_REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [GOOGLE_DRIVE_READONLY_SCOPE],
  });

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url?.startsWith(CALLBACK_PATH)) {
          res.writeHead(404);
          res.end();
          return;
        }

        const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
        const code = u.searchParams.get('code');
        const oauthError = u.searchParams.get('error');

        if (oauthError) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end(`Authorization failed: ${oauthError}`);
          server.close(() => reject(new Error(oauthError)));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing ?code= in callback URL.');
          server.close(() => reject(new Error('Missing authorization code')));
          return;
        }

        const { tokens } = await oauth2Client.getToken(code);
        const refresh = tokens.refresh_token;

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<p>Authorization complete. You can close this tab and return to the terminal.</p>',
        );

        server.close(() => {
          if (!refresh) {
            console.error(
              '\nNo refresh_token returned. Try: revoke the app under Google Account → Security → Third-party access, then run this script again so Google issues a new refresh token.\n',
            );
            reject(new Error('Missing refresh_token'));
            return;
          }
          console.log('\nAdd this to your .env file:\n');
          console.log(`GOOGLE_REFRESH_TOKEN=${refresh}\n`);
          resolve();
        });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Token exchange failed; see terminal.');
        server.close(() => reject(e));
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Callback server: ${OAUTH_REDIRECT_URI}`);
      console.log('Opening browser for Google sign-in…');
      openBrowser(authUrl);
    });

    server.on('error', reject);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
