import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

const patchSchema = z.object({
  transcript: z.string().nullable(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; assetId: string }> },
) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id: candidateId, assetId } = await ctx.params;
  if (!candidateId || !assetId) {
    return NextResponse.json({ error: 'Missing candidate id or asset id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();

  const { data: candidate, error: cErr } = await supabase
    .from('post_candidates')
    .select('source_asset_ids')
    .eq('id', candidateId)
    .maybeSingle();

  if (cErr) {
    console.error('[video-transcripts patch] candidate', cErr);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  if (!candidate) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  const rawIds = (candidate as { source_asset_ids?: unknown }).source_asset_ids;
  const ids = Array.isArray(rawIds)
    ? rawIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];

  if (!ids.includes(assetId)) {
    return NextResponse.json({ error: 'Asset not linked to this candidate' }, { status: 403 });
  }

  const now = new Date().toISOString();
  const { data: updated, error: uErr } = await supabase
    .from('content_assets')
    .update({
      transcript: parsed.data.transcript,
      updated_at: now,
    })
    .eq('id', assetId)
    .select('id, transcript')
    .maybeSingle();

  if (uErr) {
    console.error('[video-transcripts patch] update', uErr);
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  return NextResponse.json({
    asset: {
      id: updated.id,
      transcript: (updated as { transcript?: string | null }).transcript ?? null,
    },
  });
}
