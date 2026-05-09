import { NextRequest, NextResponse } from 'next/server';

import { getDriveClient } from '@/lib/google-drive-server';
import { listReviewFolderFiles, mapDriveFileToReviewDto } from '@/lib/list-review-folder';
import { assertReviewAuthorized } from '@/lib/review-auth';
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
    .select('id, review_drive_folder_id')
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
  if (!folderId) {
    return NextResponse.json({
      files: [],
      warning: 'No review_drive_folder_id for this candidate.',
    });
  }

  try {
    const drive = await getDriveClient();
    const files = await listReviewFolderFiles(drive, folderId);
    return NextResponse.json({
      files: files.map(mapDriveFileToReviewDto),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[files drive]', msg);
    return NextResponse.json(
      { error: msg, files: [] },
      { status: 502 },
    );
  }
}
