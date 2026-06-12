import { spawn } from 'node:child_process';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import { normalizeReelSpecOverlay } from '@fr94/reel-text-style';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

function repoRootFromWebCwd(): string {
  return path.resolve(process.cwd(), '..');
}

function isRenderableReel(candidate: {
  post_type?: string | null;
  reel_instructions: unknown;
  source_asset_ids: unknown;
}): boolean {
  if (candidate.post_type?.trim() !== 'reel') return false;

  const ri =
    candidate.reel_instructions != null && typeof candidate.reel_instructions === 'object'
      ? (candidate.reel_instructions as Record<string, unknown>)
      : null;

  if (ri?.version === 'clips-v1' && Array.isArray(ri.clips) && ri.clips.length > 0) {
    return true;
  }

  const sa = Array.isArray(candidate.source_asset_ids)
    ? candidate.source_asset_ids.filter((id) => typeof id === 'string' && id.trim())
    : [];
  return sa.length > 0;
}

function spawnRenderWorker(candidateId: string): Promise<void> {
  const repoRoot = repoRootFromWebCwd();
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'render:reels', '--', `--candidate-id=${candidateId}`], {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.on('error', reject);
    child.unref();
    resolve();
  });
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(_req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data: candidate, error: cErr } = await supabase
    .from('post_candidates')
    .select('id, post_type, hook, reel_instructions, source_asset_ids, source_drive_file_ids')
    .eq('id', id)
    .maybeSingle();

  if (cErr) {
    console.error('[render-reel]', cErr);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  if (!candidate) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  if (candidate.post_type?.trim() !== 'reel') {
    return NextResponse.json({ error: 'Candidate is not a reel.' }, { status: 400 });
  }

  if (!isRenderableReel(candidate)) {
    return NextResponse.json(
      { error: 'Reel has no renderable clip spec or source assets.' },
      { status: 400 },
    );
  }

  const riRaw =
    candidate.reel_instructions != null && typeof candidate.reel_instructions === 'object'
      ? (candidate.reel_instructions as Record<string, unknown>)
      : {};
  const ri = normalizeReelSpecOverlay(riRaw, (candidate.hook as string | null) ?? null);
  const sa = Array.isArray(candidate.source_asset_ids)
    ? (candidate.source_asset_ids as string[])
    : [];
  const sd = Array.isArray(candidate.source_drive_file_ids)
    ? (candidate.source_drive_file_ids as string[])
    : [];
  const now = new Date().toISOString();

  const { error: pjErr } = await supabase.from('production_jobs').upsert(
    {
      post_candidate_id: id,
      production_type: 'reel',
      status: 'queued',
      source_asset_ids: sa,
      source_drive_file_ids: sd,
      instructions: ri,
      reel_specification: ri,
      output_video_url: null,
      thumbnail_url: null,
      render_log: null,
      render_strategy: null,
      error_message: null,
      updated_at: now,
    },
    { onConflict: 'post_candidate_id,production_type' },
  );
  if (pjErr) {
    console.error('[render-reel] production_jobs upsert', pjErr);
    return NextResponse.json({ error: pjErr.message }, { status: 500 });
  }

  const { error: thumbClearErr } = await supabase
    .from('post_candidates')
    .update({ cover_thumbnail_url: null, updated_at: now })
    .eq('id', id);
  if (thumbClearErr) {
    console.warn('[render-reel] clear candidate thumbnail', thumbClearErr.message);
  }

  try {
    await spawnRenderWorker(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[render-reel] spawn', e);
    return NextResponse.json({ error: `Could not start render worker: ${msg}` }, { status: 500 });
  }

  const { data: job, error: jobErr } = await supabase
    .from('production_jobs')
    .select('*')
    .eq('post_candidate_id', id)
    .eq('production_type', 'reel')
    .maybeSingle();

  if (jobErr) {
    console.error('[render-reel] read job', jobErr);
    return NextResponse.json({ error: jobErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: 'Render started',
    candidate_id: id,
    job,
  });
}
