import { NextRequest, NextResponse } from 'next/server';

import {
  generateAssetImageThumb,
  getCachedAssetImageThumb,
} from '@/lib/asset-image-thumb-cache';
import { isImageMime } from '@/lib/asset-media-urls';
import { getDriveClient } from '@/lib/google-drive-server';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

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
    .select('id, drive_file_id, mime_type, media_type')
    .eq('id', id)
    .maybeSingle();

  if (dbErr) {
    console.error('[asset thumb]', dbErr);
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
  if (!isImageMime(mime) && mediaType !== 'image') {
    return NextResponse.json({ error: 'Thumb only available for image assets' }, { status: 400 });
  }

  try {
    const cached = getCachedAssetImageThumb(id);
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
    const jpeg = await generateAssetImageThumb(drive, id, driveFileId);

    if (!jpeg || jpeg.length === 0) {
      return NextResponse.json(
        { error: 'Could not generate image thumb (download or resize failed)' },
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
    console.error('[asset thumb]', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
