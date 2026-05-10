import { NextRequest, NextResponse } from 'next/server';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

type AssetRow = {
  id: string;
  media_type: string | null;
  final_filename: string | null;
  current_filename: string | null;
  transcript: string | null;
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();

  const { data: candidate, error: cErr } = await supabase
    .from('post_candidates')
    .select('source_asset_ids')
    .eq('id', id)
    .maybeSingle();

  if (cErr) {
    console.error('[video-transcripts get] candidate', cErr);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  if (!candidate) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  const rawIds = (candidate as { source_asset_ids?: unknown }).source_asset_ids;
  const ids = Array.isArray(rawIds)
    ? rawIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ assets: [] });
  }

  const { data: rows, error } = await supabase
    .from('content_assets')
    .select('id, media_type, final_filename, current_filename, transcript')
    .in('id', ids);

  if (error) {
    console.error('[video-transcripts get] assets', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const indexById = new Map(ids.map((uuid, i) => [uuid, i]));
  const list = ((rows ?? []) as AssetRow[]).sort(
    (a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0),
  );

  const assets = list.map((row) => ({
    id: row.id,
    media_type: row.media_type,
    label:
      row.final_filename?.trim() ||
      row.current_filename?.trim() ||
      row.id,
    transcript: row.transcript ?? null,
  }));

  return NextResponse.json({ assets });
}
