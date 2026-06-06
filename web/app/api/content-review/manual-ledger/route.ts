import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { assertReviewAuthorized, getCurrentUserEmail } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

const postSchema = z.object({
  post_type: z.string().min(1),
  posted_at: z.string().min(1),
  platform: z.string().optional().default('instagram'),
  title: z.string().optional().nullable(),
  hook: z.string().optional().nullable(),
  caption: z.string().optional().nullable(),
  selected_lane: z.string().optional().nullable(),
  narrative_function: z.string().optional().nullable(),
  title_overlay: z.string().optional().nullable(),
  visual_summary: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  instagram_permalink: z.string().optional().nullable(),
  instagram_media_id: z.string().optional().nullable(),
  related_asset_ids: z.array(z.string().uuid()).optional().default([]),
});

export async function GET(req: NextRequest) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const limitRaw = req.nextUrl.searchParams.get('limit')?.trim();
  const limit = limitRaw ? Math.min(200, Math.max(1, Number.parseInt(limitRaw, 10) || 50)) : 50;

  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase
    .from('manual_ledger_entries')
    .select('*')
    .order('posted_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[manual-ledger GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(req: NextRequest) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

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

  const createdBy = await getCurrentUserEmail(req);
  const p = parsed.data;
  const postedAt = new Date(p.posted_at);
  if (!Number.isFinite(postedAt.getTime())) {
    return NextResponse.json({ error: 'Invalid posted_at' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase
    .from('manual_ledger_entries')
    .insert({
      platform: p.platform,
      post_type: p.post_type.trim(),
      posted_at: postedAt.toISOString(),
      title: p.title?.trim() || null,
      hook: p.hook?.trim() || null,
      caption: p.caption?.trim() || null,
      selected_lane: p.selected_lane?.trim() || null,
      narrative_function: p.narrative_function?.trim() || null,
      title_overlay: p.title_overlay?.trim() || null,
      visual_summary: p.visual_summary?.trim() || null,
      notes: p.notes?.trim() || null,
      instagram_permalink: p.instagram_permalink?.trim() || null,
      instagram_media_id: p.instagram_media_id?.trim() || null,
      related_asset_ids: p.related_asset_ids,
      created_by: createdBy,
    })
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[manual-ledger POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entry: data }, { status: 201 });
}
