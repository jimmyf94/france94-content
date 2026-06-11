/**
 * Verify INSTAGRAM_GRAPH_ACCESS_TOKEN + INSTAGRAM_BUSINESS_ACCOUNT_ID against the Graph API.
 * Loads the same env files as `npm run prepare:publishing` (repo `.env`, `.env.local`).
 *
 * Usage: npm run check:instagram-token
 *
 * Optional: set META_APP_ID + META_APP_SECRET to also call debug_token (scopes, expiry).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

for (const envPath of [
  path.join(repoRoot, 'web', '.env'),
  path.join(repoRoot, '.env'),
  path.join(repoRoot, '.env.local'),
]) {
  dotenv.config({ path: envPath });
}

function mask(s: string): string {
  if (s.length <= 14) return '(too short to mask)';
  return `${s.slice(0, 10)}…${s.slice(-6)} (length ${s.length})`;
}

async function main(): Promise<void> {
  const { graphApiVersion, normalizeMetaAccessToken, requireInstagramEnv } = await import(
    './lib/publishing/instagram-graph.js'
  );

  const raw = process.env.INSTAGRAM_GRAPH_ACCESS_TOKEN ?? '';
  const rawId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? '';

  console.log('Env load order: repo .env → .env.local (later files override).');
  console.log('');
  console.log('INSTAGRAM_GRAPH_ACCESS_TOKEN raw length:', raw.length);
  console.log('INSTAGRAM_BUSINESS_ACCOUNT_ID raw:', rawId.trim() ? `"${rawId.trim().slice(0, 8)}…"` : '(empty)');

  const normalizedPreview = normalizeMetaAccessToken(raw);
  console.log('After normalizeMetaAccessToken length:', normalizedPreview.length);
  if (raw.length !== normalizedPreview.length) {
    console.log(
      '  (trimmed invisible characters / whitespace — Meta often returns "Cannot parse access token" if those remain.)',
    );
  }

  let accessToken: string;
  let igUserId: string;
  try {
    ({ accessToken, igUserId } = requireInstagramEnv());
  } catch (e) {
    console.error('\nrequireInstagramEnv:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
    return;
  }

  console.log('\nMasked token:', mask(accessToken));
  console.log('IG user id:', igUserId);

  const v = graphApiVersion();
  const probeUrl = `https://graph.facebook.com/${v}/${encodeURIComponent(igUserId)}?fields=id,username&access_token=${encodeURIComponent(accessToken)}`;

  console.log(`\nProbe: GET /${v}/{ig-user-id}?fields=id,username`);
  const res = await fetch(probeUrl);
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.error('Non-JSON response:', res.status, text.slice(0, 500));
    process.exitCode = 1;
    return;
  }

  if (!res.ok) {
    const err = json.error as { message?: string; type?: string; code?: number } | undefined;
    console.error('\nGraph API error:', err?.code, err?.type, err?.message ?? JSON.stringify(json));
    console.error('\nChecklist:');
    console.error('  • Token must be a User or Page access token with instagram_basic (+ publish as needed).');
    console.error('  • Not JSON, not app_id|app_secret, one line in .env, no quotes unless the whole value is quoted.');
    console.error('  • IG account must be Professional and linked to a Facebook Page you manage.');
    console.error('  • INSTAGRAM_BUSINESS_ACCOUNT_ID is the Instagram-scoped user id (often numeric), not @handle.');
    process.exitCode = 1;
    return;
  }

  console.log('\nOK — Graph accepted the token for this IG user:');
  console.log(JSON.stringify(json, null, 2));

  const mediaProbe = await fetch(
    `https://graph.facebook.com/${v}/${encodeURIComponent(igUserId)}/media?fields=id&limit=1&access_token=${encodeURIComponent(accessToken)}`,
  );
  const mediaJson = (await mediaProbe.json()) as { data?: { id?: string }[] };
  const sampleMediaId = mediaJson.data?.[0]?.id;
  if (sampleMediaId) {
    const { probeInsightsPermission } = await import('./lib/publishing/instagram-graph.js');
    try {
      const insightsOk = await probeInsightsPermission(sampleMediaId);
      if (insightsOk) {
        console.log('\nInsights probe: OK — instagram_manage_insights appears granted.');
      } else {
        console.warn(
          '\nInsights probe: MISSING — token lacks instagram_manage_insights (Graph #10).',
        );
        console.warn(
          '  Feedback views / avg watch time will show "—" until you regenerate the token with that scope.',
        );
        console.warn(
          '  Add instagram_manage_insights to META_SYSTEM_USER_SCOPES, then: npm run meta:system-user:generate',
        );
      }
    } catch (e) {
      console.warn('\nInsights probe failed:', e instanceof Error ? e.message : e);
    }
  }

  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (appId && appSecret) {
    const appAccessToken = `${appId}|${appSecret}`;
    const dbgUrl =
      `https://graph.facebook.com/${v}/debug_token?input_token=${encodeURIComponent(accessToken)}` +
      `&access_token=${encodeURIComponent(appAccessToken)}`;
    console.log('\nMETA_APP_ID + META_APP_SECRET set — debug_token:');
    const dbgRes = await fetch(dbgUrl);
    const dbgText = await dbgRes.text();
    if (!dbgRes.ok) {
      console.error(`debug_token HTTP ${dbgRes.status}:`, dbgText.slice(0, 600));
      return;
    }
    try {
      const dbgJson = JSON.parse(dbgText) as Record<string, unknown>;
      const data = dbgJson.data;
      if (data && typeof data === 'object' && data !== null && 'type' in data) {
        const d = data as { type?: string; is_valid?: boolean; expires_at?: number };
        const tokenType = d.type ?? 'unknown';
        const validLabel = d.is_valid === true ? 'valid' : d.is_valid === false ? 'invalid' : 'is_valid unknown';
        let expNote = '';
        if (typeof d.expires_at === 'number') {
          expNote =
            d.expires_at === 0
              ? ', expires_at=0 (often non-expiring / not applicable)'
              : `, expires_at=${d.expires_at}`;
        }
        console.log(`\ndebug_token: type=${tokenType}, ${validLabel}${expNote}`);
        if (/system/i.test(tokenType)) {
          console.log(
            '  System User access token — suitable for server workers (meta:system-user:generate / meta:system-user:refresh).',
          );
        }
      }
      console.log(JSON.stringify(dbgJson, null, 2));
    } catch {
      console.log(dbgText.slice(0, 800));
    }
  } else {
    console.log('\nTip: set META_APP_ID and META_APP_SECRET to print debug_token (scopes, expiry).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
