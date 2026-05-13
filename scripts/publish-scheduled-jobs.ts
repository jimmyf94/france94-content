/**
 * Publish due scheduled Instagram jobs (our cron/worker — not Meta scheduling).
 * Run periodically via cron (e.g. every five minutes): cd /path/to/repo && npm run publish:scheduled
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import { publishPublishingJob } from './lib/publishing/publish.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

for (const envPath of [
  path.join(repoRoot, '.env'),
  path.join(repoRoot, '.env.local'),
  path.join(repoRoot, 'web', '.env.local'),
]) {
  dotenv.config({ path: envPath });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v.trim();
}

async function main(): Promise<void> {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const nowIso = new Date().toISOString();
  const { data: rows, error } = await supabase
    .from('publishing_jobs')
    .select('id,post_candidate_id,scheduled_publish_at')
    .eq('status', 'scheduled')
    .lte('scheduled_publish_at', nowIso)
    .order('scheduled_publish_at', { ascending: true });

  if (error) throw new Error(error.message);

  const jobs = rows ?? [];
  console.log(`[publish:scheduled]\tfound ${jobs.length} due job(s) at ${nowIso}`);

  for (const j of jobs) {
    const id = j.id as string;
    try {
      const r = await publishPublishingJob(supabase, id);
      console.log(`[publish:scheduled]\tok\t${id}\tmedia=${r.mediaId ?? 'n/a'}\tpermalink=${r.permalink ?? 'n/a'}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[publish:scheduled]\tfail\t${id}\t${msg}`);
    }
  }

  console.log('[publish:scheduled]\tdone');
}

main().catch((e) => {
  console.error(e);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
