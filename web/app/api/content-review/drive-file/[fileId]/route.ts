import { Readable } from 'node:stream';

import { NextRequest, NextResponse } from 'next/server';

import { isCandidateDriveFileAllowed, loadCandidateDriveAccess } from '@/lib/candidate-drive-file-access';
import { getDriveClient } from '@/lib/google-drive-server';
import { assertReviewAuthorized } from '@/lib/review-auth';
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
    return NextResponse.json({ error: 'candidateId query and fileId path are required' }, { status: 400 });
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
      fields: 'parents, mimeType, name',
      supportsAllDrives: true,
    });

    const parents = meta.data.parents ?? [];
    if (!isCandidateDriveFileAllowed(access, fileId, parents)) {
      return NextResponse.json({ error: 'File is not an allowed candidate source' }, { status: 403 });
    }

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
    console.error('[drive-file stream]', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
