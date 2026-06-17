import { NextRequest, NextResponse } from 'next/server';

import { getDriveClient } from '@/lib/google-drive-server';
import { listReviewFolderFiles, mapDriveFileToReviewDto } from '@/lib/list-review-folder';
import { assertReviewAuthorized } from '@/lib/review-auth';

export const runtime = 'nodejs';

function requireInboxFolderId(): string | null {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  return id || null;
}

export async function GET(req: NextRequest) {
  try {
    const denied = assertReviewAuthorized(req);
    if (denied) return denied;

    const folderId = requireInboxFolderId();
    if (!folderId) {
      return NextResponse.json(
        { error: 'GOOGLE_DRIVE_FOLDER_ID is not configured' },
        { status: 503 },
      );
    }

    const drive = await getDriveClient();
    const files = await listReviewFolderFiles(drive, folderId);
    const items = files.map(mapDriveFileToReviewDto);

    let totalSizeBytes = 0;
    for (const item of items) {
      if (item.size != null) {
        const n = Number.parseInt(String(item.size), 10);
        if (Number.isFinite(n) && n > 0) totalSizeBytes += n;
      }
    }

    return NextResponse.json({
      folder_id: folderId,
      count: items.length,
      total_size_bytes: totalSizeBytes,
      items,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[ingest-inbox] GET', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
