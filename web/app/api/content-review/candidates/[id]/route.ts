import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  AssetUsageError,
  refreshCandidateAssetConflicts,
  releaseAssetsForCandidate,
  releaseStaleApprovedReservationsIfNeeded,
  reserveAssetsForCandidate,
} from '@fr94/asset-usage';
import { POST_CANDIDATE_DETAIL_COLUMNS } from '@/lib/post-candidate-api-columns';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

const reelStructureRowSchema = z.object({
  time: z.string(),
  instruction: z.string(),
});

const patchSchema = z
  .object({
    status: z.enum(['approved', 'rejected', 'needs_rewrite']).optional(),
    reviewer_notes: z.string().optional().nullable(),
    caption_fr: z.string().optional().nullable(),
    caption_en: z.string().optional().nullable(),
    hashtags: z.array(z.string()).optional().nullable(),
    reel_instructions: z
      .object({
        structure: z.array(reelStructureRowSchema),
        overlay_text: z.array(z.string()),
      })
      .strict()
      .optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.reviewer_notes !== undefined ||
      v.caption_fr !== undefined ||
      v.caption_en !== undefined ||
      v.hashtags !== undefined ||
      v.reel_instructions !== undefined,
    { message: 'Provide at least one field to update' },
  );

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase
    .from('post_candidates')
    .select(POST_CANDIDATE_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[candidate get]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  const row = data as unknown as { status: string };

  const noStore = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
  } as const;

  try {
    if (await releaseStaleApprovedReservationsIfNeeded(supabase, id, row.status)) {
      const { data: healed, error: healErr } = await supabase
        .from('post_candidates')
        .select(POST_CANDIDATE_DETAIL_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (!healErr && healed) {
        return NextResponse.json({ candidate: healed }, { headers: noStore });
      }
    }
  } catch (e) {
    console.error('[candidate get] stale reservation heal', e);
  }

  return NextResponse.json({ candidate: data }, { headers: noStore });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
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

  const {
    status,
    reviewer_notes,
    caption_fr,
    caption_en,
    hashtags,
    reel_instructions,
  } = parsed.data;
  const now = new Date().toISOString();
  const reviewedBy = process.env.REVIEWED_BY?.trim() || null;

  const supabase = getSupabaseServiceRole();

  if (status === 'approved') {
    try {
      await reserveAssetsForCandidate(supabase, id);
    } catch (e) {
      const msg = e instanceof AssetUsageError ? e.message : e instanceof Error ? e.message : String(e);
      const code = e instanceof AssetUsageError ? e.code : 'asset_usage';
      const statusCode = e instanceof AssetUsageError && e.code === 'no_assets' ? 400 : 409;
      console.warn('[candidate patch] reserve failed', { id, code, msg });
      return NextResponse.json({ error: msg, code }, { status: statusCode });
    }
  }

  if (status === 'rejected' || status === 'needs_rewrite') {
    try {
      await releaseAssetsForCandidate(supabase, id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[candidate patch] release before demote', e);
      return NextResponse.json({ error: `Could not release source assets: ${msg}` }, { status: 500 });
    }
  }

  let mergedReel: Record<string, unknown> | undefined;
  if (reel_instructions !== undefined) {
    const { data: existing, error: readErr } = await supabase
      .from('post_candidates')
      .select('reel_instructions')
      .eq('id', id)
      .maybeSingle();
    if (readErr) {
      console.error('[candidate patch] read reel', readErr);
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }
    const prev =
      existing?.reel_instructions != null && typeof existing.reel_instructions === 'object'
        ? (existing.reel_instructions as Record<string, unknown>)
        : {};
    mergedReel = {
      ...prev,
      structure: reel_instructions.structure,
      overlay_text: reel_instructions.overlay_text,
    };
  }

  const update: Record<string, unknown> = {
    updated_at: now,
  };
  if (reviewer_notes !== undefined) {
    update.reviewer_notes = reviewer_notes ?? null;
  }
  if (status !== undefined) {
    update.status = status;
    update.reviewed_at = now;
    update.reviewed_by = reviewedBy;
  }
  if (caption_fr !== undefined) {
    update.caption_fr = caption_fr ?? null;
  }
  if (caption_en !== undefined) {
    update.caption_en = caption_en ?? null;
  }
  if (hashtags !== undefined) {
    update.hashtags = hashtags ?? null;
  }
  if (mergedReel !== undefined) {
    update.reel_instructions = mergedReel;
  }

  const { data, error } = await supabase
    .from('post_candidates')
    .update(update)
    .eq('id', id)
    .select(POST_CANDIDATE_DETAIL_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error('[candidate patch]', error);
    if (status === 'approved') {
      try {
        await releaseAssetsForCandidate(supabase, id);
      } catch (re) {
        console.error('[candidate patch] rollback reserve failed', re);
      }
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    if (status === 'approved') {
      try {
        await releaseAssetsForCandidate(supabase, id);
      } catch (re) {
        console.error('[candidate patch] rollback reserve (no row)', re);
      }
    }
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  if (status === 'approved') {
    try {
      await refreshCandidateAssetConflicts(supabase, id);
    } catch (e) {
      console.error('[candidate patch] refresh conflicts (approved)', e);
    }
  }

  const { data: fresh, error: readBackErr } = await supabase
    .from('post_candidates')
    .select(POST_CANDIDATE_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (readBackErr) {
    console.error('[candidate patch] read-back', readBackErr);
    return NextResponse.json({ error: readBackErr.message }, { status: 500 });
  }

  const noStore = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
  } as const;

  return NextResponse.json({ candidate: fresh ?? data }, { headers: noStore });
}
