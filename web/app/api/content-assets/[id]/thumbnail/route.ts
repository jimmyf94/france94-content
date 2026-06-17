import { NextRequest, NextResponse } from 'next/server';

import { assetThumbnailBucketName } from '@/lib/asset-thumbnail-storage';
import { assertReviewAuthorized } from '@/lib/review-auth';
import {
  getCachedStoredThumbnail,
  setCachedStoredThumbnail,
} from '@/lib/stored-thumbnail-response-cache';
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

  const cached = getCachedStoredThumbnail('asset', id);
  if (cached) {
    return new NextResponse(new Uint8Array(cached), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=86400',
      },
    });
  }

  const supabase = getSupabaseServiceRole();
  const { data: row, error: dbErr } = await supabase
    .from('content_assets')
    .select('id, thumbnail_path, thumbnail_status')
    .eq('id', id)
    .maybeSingle();

  if (dbErr) {
    console.error('[asset thumbnail]', dbErr);
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const objectPath = (row.thumbnail_path as string | null)?.trim();
  if (!objectPath) {
    return NextResponse.json({ error: 'No stored thumbnail' }, { status: 404 });
  }

  const bucket = assetThumbnailBucketName();
  const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(objectPath);

  if (dlErr || !blob) {
    const msg = dlErr?.message ?? 'Download failed';
    console.error('[asset thumbnail]', id, msg);
    return NextResponse.json({ error: msg }, { status: 404 });
  }

  const bytes = Buffer.from(await blob.arrayBuffer());
  setCachedStoredThumbnail('asset', id, bytes);

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
