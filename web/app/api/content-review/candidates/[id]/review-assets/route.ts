import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { appendCarouselAssets } from '@/lib/append-candidate-carousel-asset';
import { copyAssetToReviewFolder } from '@/lib/copy-asset-to-review-folder';
import { getDriveClient } from '@/lib/google-drive-server';
import { POST_CANDIDATE_DETAIL_COLUMNS } from '@/lib/post-candidate-api-columns';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const CAROUSEL_MAX_SLIDES = 10;

const bodySchema = z.object({
  asset_ids: z.array(z.string().uuid()).min(1).max(CAROUSEL_MAX_SLIDES),
});

function dedupeAssetIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim().toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(raw.trim());
  }
  return out;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id: candidateId } = await ctx.params;
  if (!candidateId?.trim()) {
    return NextResponse.json({ error: 'Missing candidate id' }, { status: 400 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const json = await req.json();
    body = bodySchema.parse(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid request body';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const assetIds = dedupeAssetIds(body.asset_ids);
  if (assetIds.length === 0) {
    return NextResponse.json({ error: 'No asset ids provided' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();

  const { data: row, error: readErr } = await supabase
    .from('post_candidates')
    .select(
      'id, post_type, review_drive_folder_id, source_asset_ids, source_drive_file_ids, carousel_slides',
    )
    .eq('id', candidateId)
    .maybeSingle();

  if (readErr) {
    console.error('[review-assets post] read', readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  if ((row as { post_type?: string | null }).post_type !== 'carousel') {
    return NextResponse.json({ error: 'Only carousel candidates support adding review assets' }, { status: 400 });
  }

  const folderId = (row as { review_drive_folder_id?: string | null }).review_drive_folder_id?.trim();
  if (!folderId) {
    return NextResponse.json({ error: 'Candidate has no review folder' }, { status: 400 });
  }

  const { data: assetRows, error: assetsErr } = await supabase
    .from('content_assets')
    .select('id, drive_file_id, media_type, status')
    .in('id', assetIds);

  if (assetsErr) {
    console.error('[review-assets post] content_assets read', assetsErr);
    return NextResponse.json({ error: assetsErr.message }, { status: 500 });
  }

  const byId = new Map((assetRows ?? []).map((a) => [String(a.id).toLowerCase(), a]));
  const newAssets: Array<{ id: string; driveFileId: string }> = [];

  for (const assetId of assetIds) {
    const asset = byId.get(assetId.toLowerCase());
    if (!asset) {
      return NextResponse.json({ error: `Asset not found: ${assetId}` }, { status: 404 });
    }
    if (asset.status !== 'processed') {
      return NextResponse.json(
        { error: `Asset ${assetId} is not processed yet` },
        { status: 400 },
      );
    }
    const mediaType = typeof asset.media_type === 'string' ? asset.media_type : '';
    if (mediaType !== 'image' && mediaType !== 'video') {
      return NextResponse.json(
        { error: `Asset ${assetId} must be image or video media` },
        { status: 400 },
      );
    }
    const driveFileId = typeof asset.drive_file_id === 'string' ? asset.drive_file_id.trim() : '';
    if (!driveFileId) {
      return NextResponse.json({ error: `Asset ${assetId} has no drive file id` }, { status: 400 });
    }
    newAssets.push({ id: assetId, driveFileId });
  }

  const appendResult = appendCarouselAssets({
    source_asset_ids: (row as { source_asset_ids?: unknown }).source_asset_ids,
    source_drive_file_ids: (row as { source_drive_file_ids?: unknown }).source_drive_file_ids,
    carousel_slides: (row as { carousel_slides?: unknown }).carousel_slides,
    newAssets,
    maxSlides: CAROUSEL_MAX_SLIDES,
  });

  if ('error' in appendResult) {
    return NextResponse.json({ error: appendResult.error }, { status: 400 });
  }

  try {
    const drive = await getDriveClient();
    for (const asset of newAssets) {
      await copyAssetToReviewFolder(drive, {
        sourceDriveFileId: asset.driveFileId,
        destFolderId: folderId,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[review-assets post] drive copy', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from('post_candidates')
    .update({
      source_asset_ids: appendResult.source_asset_ids,
      source_drive_file_ids: appendResult.source_drive_file_ids,
      carousel_slides: appendResult.carousel_slides,
      updated_at: now,
    })
    .eq('id', candidateId)
    .select(POST_CANDIDATE_DETAIL_COLUMNS)
    .maybeSingle();

  if (updErr) {
    console.error('[review-assets post] candidate update', updErr);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json({ error: 'Candidate not found after update' }, { status: 404 });
  }

  return NextResponse.json({ candidate: updated });
}
