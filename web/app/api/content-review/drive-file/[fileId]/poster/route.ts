import { NextRequest, NextResponse } from 'next/server';

import { isCandidateDriveFileAllowed, loadCandidateDriveAccess } from '@/lib/candidate-drive-file-access';
import { getDriveClient } from '@/lib/google-drive-server';
import { assertReviewAuthorized } from '@/lib/review-auth';
import {
  generateReviewVideoPoster,
  getCachedReviewPoster,
} from '@/lib/review-video-poster-cache';
import { isDriveRateLimitError } from '@/lib/poster-generation-limiter';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ fileId: string }> },
) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { fileId } = await ctx.params;
  const candidateId = req.nextUrl.searchParams.get('candidateId')?.trim();

  if (!fileId || !candidateId) {
    return NextResponse.json(
      { error: 'candidateId query and fileId path are required' },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServiceRole();
  const access = await loadCandidateDriveAccess(supabase, candidateId);
  if (!access) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  try {
    const drive = await getDriveClient();

    const meta = await drive.files.get({
      fileId,
      fields: 'parents, mimeType, name, thumbnailLink',
      supportsAllDrives: true,
    });

    const parents = meta.data.parents ?? [];
    if (!isCandidateDriveFileAllowed(access, fileId, parents)) {
      return NextResponse.json({ error: 'File is not an allowed candidate source' }, { status: 403 });
    }

    const mime = meta.data.mimeType ?? '';
    if (!mime.toLowerCase().startsWith('video/')) {
      return NextResponse.json({ error: 'Poster only available for video files' }, { status: 400 });
    }

    const cached = getCachedReviewPoster(candidateId, fileId);
    if (cached) {
      return new NextResponse(new Uint8Array(cached), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'private, max-age=86400',
        },
      });
    }

    const jpeg = await generateReviewVideoPoster(drive, candidateId, fileId, {
      mimeType: mime,
      name: meta.data.name,
      thumbnailLink: meta.data.thumbnailLink,
    });

    if (!jpeg || jpeg.length === 0) {
      return NextResponse.json(
        { error: 'Could not generate video poster (ffmpeg or download failed)' },
        { status: 502 },
      );
    }

    return new NextResponse(new Uint8Array(jpeg), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[drive-file poster]', msg);
    if (isDriveRateLimitError(e)) {
      return NextResponse.json(
        { error: 'Google Drive rate limit; retry shortly' },
        { status: 429, headers: { 'Retry-After': '5' } },
      );
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
