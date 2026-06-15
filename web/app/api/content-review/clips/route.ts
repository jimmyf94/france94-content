import { NextRequest, NextResponse } from 'next/server';

import { loadReadyClipsForReels } from '@fr94/content-clips';

import { collectAttachedClipIds } from '@/lib/append-candidate-reel-clips';
import type { ClipListRow } from '@/lib/clip-list-types';
import {
  clipAssetFallbackThumbnailUrl,
  clipStoredThumbnailUrl,
} from '@/lib/clip-media-urls';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const MAX_LIMIT = 100;

function assetFilename(asset: {
  final_filename?: string | null;
  current_filename?: string | null;
}): string | null {
  return asset.final_filename?.trim() || asset.current_filename?.trim() || null;
}

function clipMatchesQuery(row: ClipListRow, q: string): boolean {
  if (!q) return true;
  const hay = [
    row.asset_filename,
    row.visual_summary,
    row.transcript_excerpt,
    ...row.hooks,
    ...row.pov_concepts,
    ...row.fitting_series_slugs,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

function toClipListRow(clip: Awaited<ReturnType<typeof loadReadyClipsForReels>>[number]): ClipListRow {
  const duration = Number(clip.end_sec) - Number(clip.start_sec);
  const assetId = clip.content_asset_id;
  const thumbnailPath = typeof clip.thumbnail_path === 'string' ? clip.thumbnail_path.trim() : '';
  return {
    id: clip.id,
    content_asset_id: assetId,
    start_sec: Number(clip.start_sec),
    end_sec: Number(clip.end_sec),
    duration_sec: Number.isFinite(duration) ? duration : 0,
    visual_summary: clip.visual_summary ?? null,
    transcript_excerpt: clip.transcript_excerpt ?? null,
    hooks: Array.isArray(clip.hooks) ? clip.hooks : [],
    pov_concepts: Array.isArray(clip.pov_concepts) ? clip.pov_concepts : [],
    fitting_series_slugs: Array.isArray(clip.fitting_series_slugs) ? clip.fitting_series_slugs : [],
    asset_filename: assetFilename(clip.asset ?? {}),
    candidate_eligibility:
      typeof clip.asset?.candidate_eligibility === 'string'
        ? clip.asset.candidate_eligibility
        : null,
    thumbnail_url: thumbnailPath ? clipStoredThumbnailUrl(clip.id) : null,
    asset_thumbnail_url: clipAssetFallbackThumbnailUrl(assetId),
  };
}

export async function GET(req: NextRequest) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '24', 10) || 24, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(sp.get('offset') ?? '0', 10) || 0, 0);
  const q = sp.get('q')?.trim().toLowerCase() ?? '';
  const candidateId = sp.get('candidate_id')?.trim() ?? '';

  const supabase = getSupabaseServiceRole();

  let attachedClipIds = new Set<string>();
  if (candidateId) {
    const { data: candidateRow, error: candidateErr } = await supabase
      .from('post_candidates')
      .select('reel_instructions, selected_clip_ids')
      .eq('id', candidateId)
      .maybeSingle();
    if (candidateErr) {
      console.error('[clips list] candidate read', candidateErr);
      return NextResponse.json({ error: candidateErr.message }, { status: 500 });
    }
    attachedClipIds = new Set(
      collectAttachedClipIds(
        (candidateRow as { reel_instructions?: unknown } | null)?.reel_instructions,
        (candidateRow as { selected_clip_ids?: unknown } | null)?.selected_clip_ids,
      ).map((id) => id.toLowerCase()),
    );
  }

  const allClips = await loadReadyClipsForReels(supabase, { limit: 500 });
  const filtered = allClips
    .map(toClipListRow)
    .filter((row) => clipMatchesQuery(row, q));

  const page = filtered.slice(offset, offset + limit);
  const nextOffset = offset + limit < filtered.length ? offset + limit : null;

  return NextResponse.json({
    items: page.map((row) => ({
      ...row,
      attached: attachedClipIds.has(row.id.toLowerCase()),
    })),
    next_offset: nextOffset,
    total: filtered.length,
  });
}
