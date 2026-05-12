import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

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

  return NextResponse.json({ candidate: data });
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  return NextResponse.json({ candidate: data });
}
