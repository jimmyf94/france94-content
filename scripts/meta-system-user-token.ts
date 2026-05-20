/**
 * Meta Business System User: install app on system user, generate access token, or refresh 60-day token.
 * @see https://developers.facebook.com/docs/marketing-api/system-users/install-apps-and-generate-tokens/
 *
 * Loads env: repo .env → .env.local (same order as check:instagram-token).
 *
 * Usage:
 *   npm run meta:system-user:install
 *   npm run meta:system-user:generate
 *   npm run meta:system-user:refresh
 *
 * Flags: --json (machine-readable output), --expires-60d (generate/refresh 60-day expiring token)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { makeAppSecretProof } from './lib/meta/appsecret-proof.js';
import { graphApiVersion, normalizeMetaAccessToken } from './lib/publishing/instagram-graph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

for (const envPath of [path.join(repoRoot, '.env'), path.join(repoRoot, '.env.local')]) {
  dotenv.config({ path: envPath });
}

/** Default scopes for Instagram publishing prep + Page access (Meta-supported list). */
const DEFAULT_META_SYSTEM_USER_SCOPES =
  'instagram_basic,instagram_content_publish,pages_read_engagement,pages_show_list';

function mask(s: string): string {
  if (s.length <= 14) return '(too short to mask)';
  return `${s.slice(0, 10)}…${s.slice(-6)} (length ${s.length})`;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 400)}`);
  }
  if (!res.ok) {
    const json = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
    const err = json.error as { message?: string; code?: number } | undefined;
    throw new Error(err?.message ?? JSON.stringify(parsed));
  }
  if (parsed === true) {
    return { success: true };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { result: parsed };
  }
  return parsed as Record<string, unknown>;
}

async function postForm(url: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(fields);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return parseJson(res);
}

async function cmdInstall(params: {
  v: string;
  systemUserId: string;
  appId: string;
  bootstrapToken: string;
}): Promise<Record<string, unknown>> {
  const url = `https://graph.facebook.com/${params.v}/${encodeURIComponent(params.systemUserId)}/applications`;
  return postForm(url, {
    business_app: params.appId,
    access_token: params.bootstrapToken,
  });
}

async function cmdGenerate(params: {
  v: string;
  systemUserId: string;
  appId: string;
  appSecret: string;
  bootstrapToken: string;
  scope: string;
  expires60d: boolean;
}): Promise<Record<string, unknown>> {
  const proof = makeAppSecretProof(params.appSecret, params.bootstrapToken);
  const url = `https://graph.facebook.com/${params.v}/${encodeURIComponent(params.systemUserId)}/access_tokens`;
  const fields: Record<string, string> = {
    business_app: params.appId,
    scope: params.scope,
    appsecret_proof: proof,
    access_token: params.bootstrapToken,
  };
  if (params.expires60d) {
    fields.set_token_expires_in_60_days = 'true';
  }
  return postForm(url, fields);
}

async function cmdRefresh(params: {
  v: string;
  appId: string;
  appSecret: string;
  fbExchangeToken: string;
  expires60d: boolean;
}): Promise<Record<string, unknown>> {
  const u = new URL(`https://graph.facebook.com/${params.v}/oauth/access_token`);
  u.searchParams.set('grant_type', 'fb_exchange_token');
  u.searchParams.set('client_id', params.appId);
  u.searchParams.set('client_secret', params.appSecret);
  u.searchParams.set('fb_exchange_token', params.fbExchangeToken);
  if (params.expires60d) {
    u.searchParams.set('set_token_expires_in_60_days', 'true');
  }
  const res = await fetch(u.toString(), { method: 'GET' });
  return parseJson(res);
}

function usage(): void {
  console.log(`Usage:
  npm run meta:system-user:install
  npm run meta:system-user:generate [--expires-60d]
  npm run meta:system-user:refresh

Env (install / generate):
  META_APP_ID
  META_APP_SECRET
  META_SYSTEM_USER_ID          Graph id of the System User (not INSTAGRAM_BUSINESS_ACCOUNT_ID)
  META_BUSINESS_BOOTSTRAP_ACCESS_TOKEN   BM admin user, admin system user, or system user token

Env (generate scopes, optional):
  META_SYSTEM_USER_SCOPES      default: ${DEFAULT_META_SYSTEM_USER_SCOPES}

Env (refresh):
  Uses META_SYSTEM_USER_REFRESH_TOKEN if set, else INSTAGRAM_GRAPH_ACCESS_TOKEN (current system user token).
  Sends set_token_expires_in_60_days=true per Meta refresh flow.

Flags:
  --json         Print JSON only (generate/refresh access_token; install returns Graph body)
  --expires-60d  For generate only: request 60-day expiring token instead of non-expiring when Meta allows

Docs: https://developers.facebook.com/docs/marketing-api/system-users/install-apps-and-generate-tokens/
`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (hasFlag('--help') || hasFlag('-h')) {
    usage();
    process.exitCode = 0;
    return;
  }
  if (!cmd) {
    usage();
    process.exitCode = 1;
    return;
  }

  const jsonOut = hasFlag('--json');
  const expires60d = hasFlag('--expires-60d');

  const v = graphApiVersion();
  const appId = requireEnv('META_APP_ID');
  const appSecret = requireEnv('META_APP_SECRET');

  if (cmd === 'refresh') {
    const raw =
      process.env.META_SYSTEM_USER_REFRESH_TOKEN?.trim() ||
      process.env.INSTAGRAM_GRAPH_ACCESS_TOKEN?.trim() ||
      '';
    const fbExchangeToken = normalizeMetaAccessToken(raw);
    if (!fbExchangeToken) {
      throw new Error(
        'Refresh needs META_SYSTEM_USER_REFRESH_TOKEN or INSTAGRAM_GRAPH_ACCESS_TOKEN (system user token to exchange).',
      );
    }
    const data = await cmdRefresh({
      v,
      appId,
      appSecret,
      fbExchangeToken,
      expires60d: true,
    });
    if (jsonOut) {
      console.log(JSON.stringify(data));
    } else {
      const at = data.access_token;
      if (typeof at === 'string' && at) {
        console.log('New access token (masked):', mask(at));
        console.log('Set INSTAGRAM_GRAPH_ACCESS_TOKEN to this value, then: npm run check:instagram-token');
        if (data.expires_in != null) {
          console.log('expires_in (seconds):', data.expires_in);
        }
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    }
    return;
  }

  const systemUserId = requireEnv('META_SYSTEM_USER_ID');
  const bootstrapRaw = requireEnv('META_BUSINESS_BOOTSTRAP_ACCESS_TOKEN');
  const bootstrapToken = normalizeMetaAccessToken(bootstrapRaw);

  if (cmd === 'install') {
    const data = await cmdInstall({ v, systemUserId, appId, bootstrapToken });
    if (jsonOut) {
      console.log(JSON.stringify(data));
    } else {
      console.log('Install app on system user — Graph response:', JSON.stringify(data, null, 2));
      console.log('Next: npm run meta:system-user:generate');
    }
    return;
  }

  if (cmd === 'generate') {
    const scope =
      process.env.META_SYSTEM_USER_SCOPES?.trim().replace(/\s+/g, '') || DEFAULT_META_SYSTEM_USER_SCOPES;
    const data = await cmdGenerate({
      v,
      systemUserId,
      appId,
      appSecret,
      bootstrapToken,
      scope,
      expires60d,
    });
    const at = data.access_token;
    if (typeof at !== 'string' || !at) {
      console.error('Unexpected response (no access_token):', JSON.stringify(data, null, 2));
      process.exitCode = 1;
      return;
    }
    if (jsonOut) {
      console.log(JSON.stringify({ access_token: at, expires_in: data.expires_in ?? null }));
    } else {
      console.log('System user access token (masked):', mask(at));
      console.log('');
      console.log('Set INSTAGRAM_GRAPH_ACCESS_TOKEN to the full token value (same variable the publishing worker uses).');
      console.log('Verify: npm run check:instagram-token');
    }
    return;
  }

  console.error(`Unknown command: ${cmd}\n`);
  usage();
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
