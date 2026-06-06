import { NextRequest, NextResponse } from 'next/server';

import {
  generateAssetVideoPoster,
  getCachedAssetPoster,
} from '@/lib/asset-video-poster-cache';
import { isVideoMime } from '@/lib/asset-media-urls';
import { getDriveClient } from '@/lib/google-drive-server';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const ASSET_POSTER_COLUMNS =
  'id, drive_file_id, mime_type, media_type, final_filename, current_filename, original_filename';

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
  const { data: row, error: dbErr } = await supabase
    .from('content_assets')
    .select(ASSET_POSTER_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (dbErr) {
    console.error('[asset poster]', dbErr);
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const driveFileId = (row.drive_file_id as string | null)?.trim();
  if (!driveFileId) {
    return NextResponse.json({ error: 'Asset has no drive_file_id' }, { status: 400 });
  }

  const mime = (row.mime_type as string | null)?.trim() ?? '';
  const mediaType = (row.media_type as string | null)?.trim() ?? '';
  if (!isVideoMime(mime) && mediaType !== 'video') {
    return NextResponse.json({ error: 'Poster only available for video assets' }, { status: 400 });
  }

  const name =
    (row.final_filename as string | null)?.trim() ||
    (row.current_filename as string | null)?.trim() ||
    (row.original_filename as string | null)?.trim() ||
    'video.mp4';

  try {
    const cached = getCachedAssetPoster(id);
    if (cached) {
      return new NextResponse(new Uint8Array(cached), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'private, max-age=86400',
        },
      });
    }

    const drive = await getDriveClient();
    const jpeg = await generateAssetVideoPoster(drive, id, driveFileId, {
      mimeType: mime || 'video/mp4',
      name,
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
    console.error('[asset poster]', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
