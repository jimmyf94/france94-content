import { NextRequest, NextResponse } from 'next/server';

import { updatePublishingJob } from '@fr94/publishing/publishing-state';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(_req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
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
  if (st !== 'scheduled') {
    return NextResponse.json({ error: `Cannot unschedule from status "${st}" (need scheduled).` }, { status: 409 });
  }

  try {
    const { data: fullJob } = await supabase
      .from('publishing_jobs')
      .select('prepared_media, instagram_creation_id')
      .eq('id', id)
      .maybeSingle();
    const hasPreparedMedia =
      Array.isArray((fullJob as { prepared_media?: unknown } | null)?.prepared_media) &&
      ((fullJob as { prepared_media?: unknown[] }).prepared_media?.length ?? 0) > 0;
    const hasContainers = Boolean(
      (fullJob as { instagram_creation_id?: string | null } | null)?.instagram_creation_id,
    );
    const nextStatus = hasPreparedMedia || hasContainers ? 'ready_to_publish' : 'draft';

    await updatePublishingJob(supabase, id, {
      status: nextStatus,
      scheduled_publish_at: null,
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
    console.error('[unschedule publishing]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
