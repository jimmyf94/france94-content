import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { updatePublishingJob } from '@fr94/publishing/publishing-state';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const bodySchema = z.object({
  scheduled_publish_at: z.string().min(1),
});

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(_req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await _req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const when = Date.parse(parsed.data.scheduled_publish_at);
  if (!Number.isFinite(when)) {
    return NextResponse.json({ error: 'scheduled_publish_at must be a valid ISO datetime' }, { status: 400 });
  }
  if (when <= Date.now()) {
    return NextResponse.json({ error: 'scheduled_publish_at must be in the future' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data: job, error: readErr } = await supabase
    .from('publishing_jobs')
    .select('id,status')
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const st = String((job as { status?: string }).status ?? '');
  if (st !== 'ready_to_publish' && st !== 'scheduled') {
    return NextResponse.json(
      { error: `Cannot schedule from status "${st}" (need ready_to_publish or scheduled).` },
      { status: 409 },
    );
  }

  try {
    const iso = new Date(when).toISOString();
    await updatePublishingJob(supabase, id, {
      status: 'scheduled',
      scheduled_publish_at: iso,
      error_message: null,
    });
    const { data: updated, error: uErr } = await supabase
      .from('publishing_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }
    return NextResponse.json({ job: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[schedule publishing]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
