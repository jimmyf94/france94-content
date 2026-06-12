import { NextRequest, NextResponse } from 'next/server';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

function sanitizeDownloadFilename(raw: string | null, fallback: string): string {
  const base = (raw ?? fallback)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

  const stem = base.replace(/\.mp4$/i, '') || fallback.replace(/\.mp4$/i, '');
  return `${stem}.mp4`;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ candidateId: string }> },
) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { candidateId } = await ctx.params;
  if (!candidateId?.trim()) {
    return NextResponse.json({ error: 'Missing candidate id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data: job, error } = await supabase
    .from('production_jobs')
    .select('status, output_video_url')
    .eq('post_candidate_id', candidateId.trim())
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[production-job download]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const outputUrl =
    job?.status === 'produced' && typeof job.output_video_url === 'string'
      ? job.output_video_url.trim()
      : '';

  if (!outputUrl) {
    return NextResponse.json({ error: 'No rendered reel' }, { status: 404 });
  }

  const filename = sanitizeDownloadFilename(
    req.nextUrl.searchParams.get('filename'),
    `${candidateId.trim()}_reel.mp4`,
  );

  try {
    const upstream = await fetch(outputUrl);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: 'Failed to fetch render' }, { status: 502 });
    }

    const headers = new Headers();
    headers.set('Content-Type', 'video/mp4');
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) headers.set('Content-Length', contentLength);
    headers.set('Cache-Control', 'private, no-store');

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[production-job download stream]', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
