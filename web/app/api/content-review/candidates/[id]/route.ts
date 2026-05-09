import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

const patchSchema = z.object({
  status: z.enum(['approved', 'rejected', 'needs_rewrite']),
  reviewer_notes: z.string().optional().nullable(),
});

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

  const { status, reviewer_notes } = parsed.data;
  const now = new Date().toISOString();
  const reviewedBy = process.env.REVIEWED_BY?.trim() || null;

  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase
    .from('post_candidates')
    .update({
      status,
      reviewer_notes: reviewer_notes ?? null,
      updated_at: now,
      reviewed_at: now,
      reviewed_by: reviewedBy,
    })
    .eq('id', id)
    .select()
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
