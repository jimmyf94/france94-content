import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

import {
  loadPipelineRow,
  needsReviewCount,
  PIPELINE_SINGLETON_KEY,
  toPipelinePayload,
} from '@/lib/pipeline-settings-server';

const runBodySchema = z.object({
  stage: z.enum(['full', 'candidates_only']),
});

function resolveGhRepository(): string | null {
  const explicit = process.env.GH_REPOSITORY?.trim();
  if (explicit) return explicit;
  const owner = process.env.VERCEL_GIT_REPO_OWNER?.trim();
  const slug = process.env.VERCEL_GIT_REPO_SLUG?.trim();
  if (owner && slug) return `${owner}/${slug}`;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const denied = assertReviewAuthorized(req);
    if (denied) return denied;

    const token = process.env.GH_DISPATCH_TOKEN?.trim();
    if (!token) {
      return NextResponse.json(
        { error: 'GH_DISPATCH_TOKEN is not configured (fine-scoped PAT with actions:write)' },
        { status: 503 },
      );
    }

    const repo = resolveGhRepository();
    if (!repo) {
      return NextResponse.json(
        { error: 'GH_REPOSITORY is not configured (owner/repo)' },
        { status: 503 },
      );
    }

    const json: unknown = await req.json().catch(() => null);
    const parsed = runBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const ref = process.env.GH_DISPATCH_REF?.trim() || 'main';
    const dispatchRes = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/auto-ingest.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          ref,
          inputs: { stage: parsed.data.stage },
        }),
      },
    );

    if (!dispatchRes.ok) {
      const body = await dispatchRes.text().catch(() => '');
      console.error('[pipeline/run] GitHub dispatch failed', dispatchRes.status, body);
      return NextResponse.json(
        { error: `GitHub dispatch failed (${dispatchRes.status})` },
        { status: 502 },
      );
    }

    const supabase = getSupabaseServiceRole();
    const dispatchedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('pipeline_settings')
      .update({
        last_run_status: 'dispatching',
        last_run_summary: { stage: parsed.data.stage, dispatched_at: dispatchedAt },
        updated_at: dispatchedAt,
      })
      .eq('singleton', PIPELINE_SINGLETON_KEY);

    if (updateError) {
      console.error('[pipeline/run] pipeline_settings update', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const [row, needsReview] = await Promise.all([loadPipelineRow(supabase), needsReviewCount(supabase)]);
    return NextResponse.json(toPipelinePayload(row, needsReview));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[pipeline/run] POST', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
