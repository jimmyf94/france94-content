import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { SERIES_POST_TYPES, normalizeSeriesRow } from '@fr94/content-series';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

const exampleSchema = z.object({
  hook: z.string().optional(),
  notes: z.string().optional(),
  url: z.string().optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  weight: z.number().min(0).optional(),
  body_md: z.string().optional(),
  status: z.enum(['active', 'archived']).optional(),
  description: z.string().optional(),
  vision: z.string().optional(),
  tone: z.string().optional(),
  discovery_patterns: z.array(z.string()).optional(),
  examples: z.array(exampleSchema).optional(),
  example_creators: z.array(z.string()).optional(),
  target_platforms: z.array(z.string()).optional(),
  enabled_post_types: z.array(z.enum(SERIES_POST_TYPES)).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await params;

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

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  const p = parsed.data;
  if (p.name !== undefined) update.name = p.name.trim();
  if (p.weight !== undefined) update.weight = p.weight;
  if (p.body_md !== undefined) update.body_md = p.body_md;
  if (p.status !== undefined) update.status = p.status;
  if (p.description !== undefined) update.description = p.description;
  if (p.vision !== undefined) update.vision = p.vision;
  if (p.tone !== undefined) update.tone = p.tone;
  if (p.discovery_patterns !== undefined) update.discovery_patterns = p.discovery_patterns;
  if (p.examples !== undefined) update.examples = p.examples;
  if (p.example_creators !== undefined) update.example_creators = p.example_creators;
  if (p.target_platforms !== undefined) update.target_platforms = p.target_platforms;
  if (p.enabled_post_types !== undefined) update.enabled_post_types = p.enabled_post_types;

  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase
    .from('content_series')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[content-series PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Series not found' }, { status: 404 });
  }

  return NextResponse.json({ series: normalizeSeriesRow(data as Record<string, unknown>) });
}
