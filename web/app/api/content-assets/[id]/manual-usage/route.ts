import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { recordAssetUsageEvent, updateAssetUsageSummary } from '@fr94/asset-usage';
import { MANUAL_USAGE_TYPES } from '@/lib/asset-library-types';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const postSchema = z
  .object({
    usage_type: z.enum(MANUAL_USAGE_TYPES),
    occurred_at: z.string().optional(),
    notes: z.string().nullable().optional(),
    mark_stale: z.boolean(),
  })
  .strict();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { usage_type, occurred_at, notes, mark_stale } = parsed.data;
  let usedAt = new Date().toISOString();
  if (occurred_at?.trim()) {
    const t = Date.parse(occurred_at.trim());
    if (!Number.isFinite(t)) {
      return NextResponse.json({ error: 'Invalid occurred_at' }, { status: 400 });
    }
    usedAt = new Date(t).toISOString();
  }
  const now = new Date().toISOString();
  const supabase = getSupabaseServiceRole();

  const { data: existing, error: readErr } = await supabase
    .from('content_assets')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (readErr) {
    console.error('[manual-usage]', readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    await recordAssetUsageEvent(supabase, {
      contentAssetId: id,
      postCandidateId: null,
      publishingJobId: null,
      usageStage: 'published',
      usageType: usage_type,
      eventKind: usage_type,
      ledgerPostType: usage_type,
      usageRole: 'primary',
      lockStrength: 'soft',
      notes: notes?.trim() || 'Recorded manual usage (outside system)',
      usedAt,
      publishedAt: usedAt,
    });
    await updateAssetUsageSummary(supabase, id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[manual-usage record]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (mark_stale) {
    const { error: stErr } = await supabase
      .from('content_assets')
      .update({
        candidate_eligibility: 'stale',
        manually_marked_stale_at: now,
        updated_at: now,
      })
      .eq('id', id);
    if (stErr) {
      console.error('[manual-usage stale]', stErr);
      return NextResponse.json({ error: stErr.message }, { status: 500 });
    }
  }

  const { data: asset, error: aErr } = await supabase
    .from('content_assets')
    .select(
      'id,candidate_eligibility,manually_marked_stale_at,usage_count,last_used_at,suggestion_count,last_suggested_at',
    )
    .eq('id', id)
    .maybeSingle();

  if (aErr) {
    return NextResponse.json({ error: aErr.message }, { status: 500 });
  }

  return NextResponse.json({ asset });
}
