import type { SupabaseClient } from '@supabase/supabase-js';

export type ContentLedgerRow = {
  source: string;
  ledger_id: string;
  candidate_id: string | null;
  manual_id: string | null;
  platform: string | null;
  post_type: string;
  selected_series: string | null;
  narrative_function: string | null;
  title: string | null;
  hook: string | null;
  title_overlay: string | null;
  caption_excerpt: string | null;
  source_asset_ids: string[] | null;
  primary_asset_id: string | null;
  scheduled_publish_at: string | null;
  published_at: string | null;
  status: string;
  cooldown_until: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  committed_at: string | null;
};

export type CommittedPostForPrompt = {
  ledger_id: string;
  source: string;
  post_type: string;
  selected_series: string | null;
  title: string | null;
  hook: string | null;
  primary_asset_id: string | null;
  scheduled_publish_at: string | null;
  published_at: string | null;
  committed_at: string | null;
  status: string;
};

const DEFAULT_DAYS = 60;
const DEFAULT_LIMIT = 80;

export function toCommittedPostForPrompt(row: ContentLedgerRow): CommittedPostForPrompt {
  return {
    ledger_id: row.ledger_id,
    source: row.source,
    post_type: row.post_type,
    selected_series: row.selected_series,
    title: row.title,
    hook: row.hook,
    primary_asset_id: row.primary_asset_id,
    scheduled_publish_at: row.scheduled_publish_at,
    published_at: row.published_at,
    committed_at: row.committed_at,
    status: row.status,
  };
}

export async function loadRecentLedgerContext(
  supabase: SupabaseClient,
  params: { days?: number; limit?: number } = {},
): Promise<ContentLedgerRow[]> {
  const days = params.days ?? DEFAULT_DAYS;
  const limit = params.limit ?? DEFAULT_LIMIT;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('v_content_ledger')
    .select('*')
    .gte('committed_at', cutoff)
    .order('committed_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`loadRecentLedgerContext: ${error.message}`);
  return (data ?? []) as ContentLedgerRow[];
}
