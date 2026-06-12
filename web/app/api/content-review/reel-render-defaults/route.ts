import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { loadReelRenderDefaults, saveReelRenderDefaults } from '@fr94/reel-render-defaults';
import { REEL_TEXT_POSITIONS, resolveReelTextStyle } from '@fr94/reel-text-style';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

const putBodySchema = z.object({
  fontsize: z.number().int().min(24).max(72),
  font_color: z.string().trim().min(1).max(32),
  outline_width: z.number().int().min(0).max(12),
  outline_color: z.string().trim().min(1).max(32),
  position: z.enum(REEL_TEXT_POSITIONS),
  line_spacing: z.number().int().min(0).max(40),
  centered: z.boolean(),
});

export async function GET(req: NextRequest) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  try {
    const supabase = getSupabaseServiceRole();
    const defaults = await loadReelRenderDefaults(supabase);
    return NextResponse.json({ defaults });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[reel-render-defaults] GET', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = putBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServiceRole();
    const style = resolveReelTextStyle(parsed.data);
    const result = await saveReelRenderDefaults(supabase, style);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, defaults: style, updated_at: result.updated_at });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[reel-render-defaults] PUT', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
