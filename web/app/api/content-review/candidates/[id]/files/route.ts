import { NextRequest, NextResponse } from 'next/server';

import { enrichReviewDriveFiles } from '@/lib/enrich-review-drive-files';
import { getDriveClient } from '@/lib/google-drive-server';
import { listCandidateSourceReviewFiles } from '@/lib/list-candidate-source-files';
import { listReviewFolderFiles, mapDriveFileToReviewDto } from '@/lib/list-review-folder';
import { assertReviewAuthorized } from '@/lib/review-auth';
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
      'id, review_drive_folder_id, source_asset_ids, source_drive_file_ids, reel_instructions',
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
    if (folderId) {
      warmReviewVideoPosters(drive, enriched, id, folderId);
    }
    return NextResponse.json({ files: enriched });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[files drive]', msg);
    return NextResponse.json(
      { error: msg, files: [] },
      { status: 502 },
    );
  }
}
