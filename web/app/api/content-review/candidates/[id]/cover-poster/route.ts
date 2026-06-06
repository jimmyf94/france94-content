import { NextRequest, NextResponse } from 'next/server';

import {
  generateCandidateCoverPoster,
  getCachedCandidateCoverPoster,
} from '@/lib/candidate-cover-poster-cache';
import { getDriveClient } from '@/lib/google-drive-server';
import { isDriveRateLimitError } from '@/lib/poster-generation-limiter';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const JPEG_HEADERS = {
  'Content-Type': 'image/jpeg',
  'Cache-Control': 'private, max-age=86400',
} as const;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id: candidateId } = await ctx.params;
  if (!candidateId?.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data: row, error: dbErr } = await supabase
    .from('post_candidates')
    .select('review_drive_folder_id')
    .eq('id', candidateId)
    .maybeSingle();

  if (dbErr) {
    console.error('[candidate cover-poster]', dbErr);
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  const folderId = row.review_drive_folder_id?.trim();
  if (!folderId) {
    return NextResponse.json({ error: 'Candidate has no review folder' }, { status: 400 });
  }

  try {
    const cached = getCachedCandidateCoverPoster(candidateId);
    if (cached) {
      return new NextResponse(new Uint8Array(cached), { status: 200, headers: JPEG_HEADERS });
    }

    const drive = await getDriveClient();
    const jpeg = await generateCandidateCoverPoster(drive, candidateId, folderId);

    if (!jpeg || jpeg.length === 0) {
      return NextResponse.json(
        { error: 'Could not generate cover poster (no video or ffmpeg failed)' },
        { status: 502 },
      );
    }

    return new NextResponse(new Uint8Array(jpeg), { status: 200, headers: JPEG_HEADERS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[candidate cover-poster]', msg);
    if (isDriveRateLimitError(e)) {
      return NextResponse.json(
        { error: 'Google Drive rate limit; retry shortly' },
        { status: 429, headers: { 'Retry-After': '5' } },
      );
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
