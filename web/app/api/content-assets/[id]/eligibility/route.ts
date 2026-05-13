import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { recordAssetUsageEvent } from '@fr94/asset-usage';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    candidate_eligibility: z.enum([
      'eligible',
      'excluded',
      'stale',
      'manual_only',
      'needs_review',
    ]),
    asset_notes: z.string().nullable().optional(),
  })
  .strict();

function auditEventKindForEligibility(v: string): 'excluded' | 'stale' | 'reenabled' {
  if (v === 'excluded' || v === 'manual_only') return 'excluded';
  if (v === 'stale') return 'stale';
  return 'reenabled';
}

export async function PATCH(
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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { candidate_eligibility, asset_notes } = parsed.data;
  const now = new Date().toISOString();
  const supabase = getSupabaseServiceRole();

  const { data: existing, error: readErr } = await supabase
    .from('content_assets')
    .select('id,candidate_eligibility')
    .eq('id', id)
    .maybeSingle();
  if (readErr) {
    console.error('[eligibility patch]', readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const prevEl = String(
    (existing as { candidate_eligibility?: string | null }).candidate_eligibility ?? 'eligible',
  ).trim();
  const elChanged = prevEl !== candidate_eligibility;

  const update: Record<string, unknown> = {
    candidate_eligibility,
    updated_at: now,
  };
  if (elChanged && candidate_eligibility === 'stale') {
    update.manually_marked_stale_at = now;
  } else if (
    elChanged &&
    (candidate_eligibility === 'eligible' || candidate_eligibility === 'needs_review')
  ) {
    update.manually_marked_stale_at = null;
  }

  if (asset_notes !== undefined) {
    update.asset_notes = asset_notes ?? null;
  }

  const { data: asset, error: upErr } = await supabase
    .from('content_assets')
    .update(update)
    .eq('id', id)
    .select(
      'id,candidate_eligibility,asset_notes,manually_marked_stale_at,usage_count,suggestion_count,last_used_at,last_suggested_at',
    )
    .maybeSingle();

  if (upErr) {
    console.error('[eligibility patch update]', upErr);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  try {
    if (elChanged) {
      const ek = auditEventKindForEligibility(candidate_eligibility);
      await recordAssetUsageEvent(supabase, {
        contentAssetId: id,
        postCandidateId: null,
        publishingJobId: null,
        usageStage: 'released',
        usageType: 'other',
        eventKind: ek,
        ledgerPostType: candidate_eligibility,
        notes: `Eligibility set to ${candidate_eligibility} via asset library`,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[eligibility patch audit]', msg);
  }

  return NextResponse.json({ asset });
}
