import { NextRequest, NextResponse } from 'next/server';

import { POST_CANDIDATE_LIST_COLUMNS } from '@/lib/post-candidate-api-columns';
import type { AssetDetailResponse, AssetUsageEventDto } from '@/lib/asset-library-types';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const ASSET_DETAIL_COLUMNS = [
  'id',
  'drive_file_id',
  'drive_parent_folder_id',
  'drive_web_view_link',
  'original_filename',
  'current_filename',
  'final_filename',
  'renamed_filename',
  'mime_type',
  'file_extension',
  'file_size',
  'media_type',
  'status',
  'analysis_status',
  'activity',
  'content_lane',
  'quality_score',
  'mission_score',
  'human_score',
  'sponsor_safety_score',
  'visual_summary',
  'semantic_summary',
  'transcript',
  'audio_transcript',
  'tags',
  'capture_time',
  'processed_at',
  'imported_at',
  'duration_seconds',
  'video_width',
  'video_height',
  'candidate_eligibility',
  'usage_count',
  'suggestion_count',
  'last_used_at',
  'last_suggested_at',
  'manually_marked_stale_at',
  'asset_notes',
  'usage_status',
  'hard_locked',
  'last_published_at',
  'reuse_allowed_after',
].join(',');

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();

  const { data: asset, error: aErr } = await supabase
    .from('content_assets')
    .select(ASSET_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (aErr) {
    console.error('[content-assets get]', aErr);
    return NextResponse.json({ error: aErr.message }, { status: 500 });
  }
  if (!asset) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: evRows, error: eErr } = await supabase
    .from('asset_usage_events')
    .select(
      [
        'id',
        'usage_stage',
        'usage_type',
        'event_kind',
        'post_type',
        'post_candidate_id',
        'publishing_job_id',
        'platform',
        'notes',
        'used_at',
        'published_at',
        'created_at',
      ].join(','),
    )
    .eq('content_asset_id', id)
    .order('used_at', { ascending: false })
    .limit(200);

  if (eErr) {
    console.error('[content-assets get events]', eErr);
    return NextResponse.json({ error: eErr.message }, { status: 500 });
  }

  const usage_events: AssetUsageEventDto[] = (evRows ?? []).map((raw) => {
    const e = raw as unknown as Record<string, unknown>;
    return {
      id: String(e.id ?? ''),
      usage_stage: String(e.usage_stage ?? ''),
      usage_type: String(e.usage_type ?? ''),
      event_kind: (e.event_kind as string | null | undefined) ?? null,
      post_type: (e.post_type as string | null | undefined) ?? null,
      post_candidate_id: (e.post_candidate_id as string | null | undefined) ?? null,
      publishing_job_id: (e.publishing_job_id as string | null | undefined) ?? null,
      platform: (e.platform as string | null | undefined) ?? null,
      notes: (e.notes as string | null | undefined) ?? null,
      used_at: (e.used_at as string | null | undefined) ?? null,
      published_at: (e.published_at as string | null | undefined) ?? null,
      created_at: (e.created_at as string | null | undefined) ?? null,
    };
  });

  const jobIds = [
    ...new Set(
      usage_events.map((u) => u.publishing_job_id).filter((x): x is string => !!x?.trim()),
    ),
  ];

  const { data: cands, error: cErr } = await supabase
    .from('post_candidates')
    .select(POST_CANDIDATE_LIST_COLUMNS)
    .contains('source_asset_ids', [id])
    .order('updated_at', { ascending: false })
    .limit(50);

  if (cErr) {
    console.error('[content-assets get candidates]', cErr);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  let publishing_jobs: Record<string, unknown>[] = [];
  if (jobIds.length > 0) {
    const { data: jobs, error: jErr } = await supabase
      .from('publishing_jobs')
      .select(
        'id,status,post_candidate_id,publish_type,scheduled_publish_at,published_at,created_at,updated_at,instagram_permalink',
      )
      .in('id', jobIds);
    if (jErr) {
      console.error('[content-assets get jobs]', jErr);
    } else {
      publishing_jobs = (jobs ?? []) as unknown as Record<string, unknown>[];
    }
  }

  const body: AssetDetailResponse = {
    asset: asset as unknown as Record<string, unknown>,
    usage_events,
    related_candidates: (cands ?? []) as unknown as Record<string, unknown>[],
    publishing_jobs: publishing_jobs as unknown as Record<string, unknown>[],
  };

  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    },
  });
}
