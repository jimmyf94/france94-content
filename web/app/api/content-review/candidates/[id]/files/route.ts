import { NextRequest, NextResponse } from 'next/server';

import { enrichReviewDriveFiles } from '@/lib/enrich-review-drive-files';
import { getDriveClient } from '@/lib/google-drive-server';
import { listCandidateSourceReviewFiles } from '@/lib/list-candidate-source-files';
import { listReviewFolderFiles, mapDriveFileToReviewDto } from '@/lib/list-review-folder';
import { orderCarouselReviewFiles } from '@/lib/order-carousel-review-files';
import { assertReviewAuthorized } from '@/lib/review-auth';
import type { AssetNameRow } from '@/lib/review-folder-asset-match';
import { warmReviewVideoPosters } from '@/lib/review-video-poster-cache';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data: row, error: dbErr } = await supabase
    .from('post_candidates')
    .select(
      'id, post_type, review_drive_folder_id, source_asset_ids, source_drive_file_ids, reel_instructions, carousel_slides',
    )
    .eq('id', id)
    .maybeSingle();

  if (dbErr) {
    console.error('[files]', dbErr);
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  const folderId = row.review_drive_folder_id?.trim();

  try {
    const drive = await getDriveClient();
    let mapped: Awaited<ReturnType<typeof mapDriveFileToReviewDto>>[];

    if (folderId) {
      const files = await listReviewFolderFiles(drive, folderId);
      mapped = files.map(mapDriveFileToReviewDto);
    } else {
      mapped = await listCandidateSourceReviewFiles(supabase, drive, row);
    }

    const enriched = await enrichReviewDriveFiles(drive, mapped, id);
    let filesOut = enriched;

    if ((row as { post_type?: string }).post_type === 'carousel' && folderId) {
      const sourceAssetIds = Array.isArray(row.source_asset_ids)
        ? row.source_asset_ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
        : [];
      let assetRows: AssetNameRow[] = [];
      if (sourceAssetIds.length > 0) {
        const { data: assetData } = await supabase
          .from('content_assets')
          .select('id, final_filename, current_filename, original_filename')
          .in('id', sourceAssetIds);
        assetRows = (assetData ?? []) as AssetNameRow[];
      }
      filesOut = orderCarouselReviewFiles({
        files: enriched,
        source_asset_ids: row.source_asset_ids,
        source_drive_file_ids: row.source_drive_file_ids,
        carousel_slides: row.carousel_slides,
        assetRows,
      });
    }

    if (folderId) {
      warmReviewVideoPosters(drive, filesOut, id, folderId);
    }
    return NextResponse.json({ files: filesOut });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[files drive]', msg);
    return NextResponse.json(
      { error: msg, files: [] },
      { status: 502 },
    );
  }
}
