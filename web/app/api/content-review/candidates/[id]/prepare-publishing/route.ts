import { spawn } from 'node:child_process';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const STAGEABLE_JOB_STATUSES = ['draft', 'failed'];

function repoRootFromWebCwd(): string {
  return path.resolve(process.cwd(), '..');
}

function canPreparePublishing(
  candidateStatus: string,
  jobStatus: string | null,
): { ok: true } | { ok: false; error: string; status: number } {
  if (candidateStatus === 'rejected' || candidateStatus === 'needs_review' || candidateStatus === 'needs_rewrite') {
    return {
      ok: false,
      status: 409,
      error: `Candidate must be approved before publishing prep (current status: ${candidateStatus}).`,
    };
  }

  if (jobStatus === 'scheduled' || jobStatus === 'published' || jobStatus === 'publishing') {
    return {
      ok: false,
      status: 409,
      error: `Publishing job already staged (status: ${jobStatus}).`,
    };
  }

  if (candidateStatus === 'approved' || candidateStatus === 'ready_to_publish') {
    if (!jobStatus) return { ok: true };
    if (STAGEABLE_JOB_STATUSES.includes(jobStatus)) return { ok: true };
    return {
      ok: false,
      status: 409,
      error: `Publishing job already exists with status "${jobStatus}".`,
    };
  }

  return {
    ok: false,
    status: 409,
    error: `Cannot prepare publishing for candidate status "${candidateStatus}".`,
  };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data: candidate, error: cErr } = await supabase
    .from('post_candidates')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();

  if (cErr) {
    console.error('[prepare-publishing]', cErr);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  if (!candidate) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  const { data: job } = await supabase
    .from('publishing_jobs')
    .select('id, status')
    .eq('post_candidate_id', id)
    .maybeSingle();

  const gate = canPreparePublishing(
    String(candidate.status ?? ''),
    job?.status != null ? String(job.status) : null,
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const repoRoot = repoRootFromWebCwd();
  const scriptPath = path.join(repoRoot, 'scripts', 'prepare-publishing-jobs.ts');
  const tsxPath = path.join(repoRoot, 'node_modules', '.bin', 'tsx');

  try {
    const child = spawn(tsxPath, [scriptPath, `--candidate-id=${id}`, '--validate-only'], {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[prepare-publishing] spawn', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: 'Publishing staging started',
    candidate_id: id,
  });
}
