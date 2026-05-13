import { Readable } from 'node:stream';

import { NextRequest, NextResponse } from 'next/server';

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
    .select('drive_file_id')
    .eq('id', id)
    .maybeSingle();

  if (dbErr) {
    console.error('[asset preview]', dbErr);
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  const fileId = (row as { drive_file_id?: string } | null)?.drive_file_id?.trim();
  if (!fileId) {
    return NextResponse.json({ error: 'Asset has no drive_file_id' }, { status: 400 });
  }

  try {
    const drive = await getDriveClient();
    const range = req.headers.get('range') ?? undefined;

    const gRes = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      {
        responseType: 'stream',
        headers: range ? { Range: range } : {},
      },
    );

    const headers = new Headers();
    const rh = gRes.headers;
    const pick = (name: string) => {
      const v = rh[name as keyof typeof rh];
      return typeof v === 'string' ? v : undefined;
    };

    const ct = pick('content-type');
    if (ct) headers.set('Content-Type', ct);

    const cl = pick('content-length');
    if (cl) headers.set('Content-Length', cl);

    const cr = pick('content-range');
    if (cr) headers.set('Content-Range', cr);

    headers.set('Accept-Ranges', pick('accept-ranges') ?? 'bytes');
    headers.set('Cache-Control', 'private, max-age=3600');

    const status = typeof gRes.status === 'number' ? gRes.status : 200;
    const nodeStream = gRes.data as Readable;

    const onAbort = () => {
      if (!nodeStream.destroyed) nodeStream.destroy();
    };
    if (req.signal.aborted) {
      onAbort();
      return NextResponse.json({ error: 'Request aborted' }, { status: 499 });
    }
    req.signal.addEventListener('abort', onAbort, { once: true });
    nodeStream.once('close', () => req.signal.removeEventListener('abort', onAbort));

    const webStream = Readable.toWeb(nodeStream);

    return new NextResponse(webStream as unknown as BodyInit, { status, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[asset preview stream]', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
