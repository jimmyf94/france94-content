import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { SERIES_POST_TYPES, normalizeSeriesRow } from '@fr94/content-series';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

const SERIES_STATUSES = ['active', 'archived'] as const;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const exampleSchema = z.object({
  hook: z.string().optional(),
  notes: z.string().optional(),
  url: z.string().optional(),
});

const postSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  weight: z.number().min(0).optional().default(1),
  body_md: z.string().optional().default(''),
  status: z.enum(SERIES_STATUSES).optional().default('active'),
  description: z.string().optional().default(''),
  vision: z.string().optional().default(''),
  tone: z.string().optional().default(''),
  discovery_patterns: z.array(z.string()).optional().default([]),
  examples: z.array(exampleSchema).optional().default([]),
  example_creators: z.array(z.string()).optional().default([]),
  target_platforms: z.array(z.string()).optional().default(['instagram']),
  enabled_post_types: z.array(z.enum(SERIES_POST_TYPES)).optional().default([]),
});

export async function GET(req: NextRequest) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const status = req.nextUrl.searchParams.get('status')?.trim();
  const supabase = getSupabaseServiceRole();

  let query = supabase.from('content_series').select('*').order('weight', { ascending: false });
  if (status && SERIES_STATUSES.includes(status as (typeof SERIES_STATUSES)[number])) {
    query = query.eq('status', status);
  }

  const { data, error } = await query.order('name', { ascending: true });
  if (error) {
    console.error('[content-series GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    series: (data ?? []).map((row) => normalizeSeriesRow(row as Record<string, unknown>)),
  });
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

  const p = parsed.data;
  const slug = (p.slug?.trim() || slugify(p.name)) || slugify('series');
  const now = new Date().toISOString();

  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase
    .from('content_series')
    .insert({
      slug,
      name: p.name.trim(),
      weight: p.weight,
      body_md: p.body_md,
      status: p.status,
      description: p.description,
      vision: p.vision,
      tone: p.tone,
      discovery_patterns: p.discovery_patterns,
      examples: p.examples,
      example_creators: p.example_creators,
      target_platforms: p.target_platforms,
      enabled_post_types: p.enabled_post_types,
      updated_at: now,
    })
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[content-series POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Insert returned no row' }, { status: 500 });
  }

  return NextResponse.json(
    { series: normalizeSeriesRow(data as Record<string, unknown>) },
    { status: 201 },
  );
}
