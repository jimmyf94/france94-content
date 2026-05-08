import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { reverseGeocodeNominatim, ReverseGeocodeError } from './lib/reverse-geocode.js';

type UnresolvedAsset = {
  id: string;
  latitude: number;
  longitude: number;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return n;
}

function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function truncate(e: unknown, max = 300): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length <= max ? msg : `${msg.slice(0, max)}…`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchUnresolved(
  supabase: SupabaseClient,
  limit: number,
): Promise<UnresolvedAsset[]> {
  const { data, error } = await supabase
    .from('content_assets')
    .select('id, latitude, longitude')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .is('geo_resolved_at', null)
    .order('imported_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as UnresolvedAsset[];
}

export async function reverseGeocodePendingAssets(): Promise<void> {
  const userAgent = requireEnv('NOMINATIM_USER_AGENT');
  const baseUrl = process.env.NOMINATIM_BASE_URL?.trim() || undefined;
  const acceptLanguage = process.env.NOMINATIM_ACCEPT_LANGUAGE?.trim() || undefined;
  const batch = envInt('GEOCODE_BATCH_SIZE', 25);
  const minIntervalMs = envInt('NOMINATIM_MIN_INTERVAL_MS', 1100);

  const supabase = getSupabaseClient();

  const rows = await fetchUnresolved(supabase, batch);
  console.log(`pending content_assets needing geocode: ${rows.length}`);

  if (rows.length === 0) {
    console.log('summary: processed=0 geocoded=0 failed=0');
    return;
  }

  let geocoded = 0;
  let failed = 0;
  let last = 0;

  for (const r of rows) {
    const wait = Math.max(0, minIntervalMs - (Date.now() - last));
    if (wait > 0) await sleep(wait);
    last = Date.now();

    try {
      const g = await reverseGeocodeNominatim(r.latitude, r.longitude, {
        userAgent,
        baseUrl,
        acceptLanguage,
      });

      const now = new Date().toISOString();
      const { error } = await supabase
        .from('content_assets')
        .update({
          geo_label: g.label,
          geo_country: g.country,
          geo_country_code: g.country_code,
          geo_admin_region: g.admin_region,
          geo_locality: g.locality,
          geo_raw: g.raw,
          geo_provider: 'nominatim',
          geo_resolved_at: now,
          updated_at: now,
        })
        .eq('id', r.id);

      if (error) throw error;

      console.log(`[geocoded] ${r.id}\t${g.label ?? 'unknown'}`);
      geocoded += 1;
    } catch (e) {
      const status = e instanceof ReverseGeocodeError ? ` (status=${e.status ?? 'n/a'})` : '';
      console.warn(`[geocode-failed]${status} ${r.id}\t${truncate(e)}`);
      failed += 1;
    }
  }

  console.log(`summary: processed=${rows.length} geocoded=${geocoded} failed=${failed}`);
}

function isExecutedDirectly(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return path.resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  reverseGeocodePendingAssets().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
