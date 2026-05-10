import { NextRequest, NextResponse } from 'next/server';

import { getDriveClient } from '@/lib/google-drive-server';
import {
  resolveReviewFolderFileSourceIndex,
  type AssetNameRow,
} from '@/lib/review-folder-asset-match';
import { pruneCandidateStructureForRemovedAsset } from '@/lib/prune-candidate-structure-for-asset';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; fileId: string }> },
) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id: candidateId, fileId } = await ctx.params;
  if (!candidateId?.trim() || !fileId?.trim()) {
    return NextResponse.json({ error: 'Missing candidate id or file id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();

  const { data: row, error: readErr } = await supabase
    .from('post_candidates')
    .select(
      'id, post_type, review_drive_folder_id, source_asset_ids, source_drive_file_ids, story_frames, carousel_slides',
    )
    .eq('id', candidateId)
    .maybeSingle();

  if (readErr) {
    console.error('[review-assets delete] read', readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  const folderId = (row as { review_drive_folder_id?: string | null }).review_drive_folder_id?.trim();
  if (!folderId) {
    return NextResponse.json({ error: 'Candidate has no review folder' }, { status: 400 });
  }

  const rawDriveIds = (row as { source_drive_file_ids?: unknown }).source_drive_file_ids;
  const rawAssetIds = (row as { source_asset_ids?: unknown }).source_asset_ids;
  const driveIds = Array.isArray(rawDriveIds)
    ? rawDriveIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];
  const assetIds = Array.isArray(rawAssetIds)
    ? rawAssetIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];

  if (assetIds.length === 0) {
    return NextResponse.json(
      { error: 'Candidate has no source assets to detach' },
      { status: 400 },
    );
  }

  let driveFileName = '';
  try {
    const drive = await getDriveClient();

    const meta = await drive.files.get({
      fileId,
      fields: 'name, parents',
      supportsAllDrives: true,
    });
    const parents = meta.data.parents ?? [];
    if (!parents.includes(folderId)) {
      return NextResponse.json({ error: 'File is not in candidate review folder' }, { status: 403 });
    }
    driveFileName = meta.data.name?.trim() ?? '';

    const { data: assetRows, error: assetsErr } = await supabase
      .from('content_assets')
      .select('id, final_filename, current_filename, original_filename')
      .in('id', assetIds);

    if (assetsErr) {
      console.error('[review-assets delete] content_assets read', assetsErr);
      return NextResponse.json({ error: assetsErr.message }, { status: 500 });
    }

    let idx = resolveReviewFolderFileSourceIndex(
      fileId,
      driveFileName,
      assetIds,
      driveIds,
      (assetRows ?? []) as AssetNameRow[],
      null,
    );

    if (
      idx === -1 &&
      driveIds.length === assetIds.length &&
      driveIds.length > 0
    ) {
      const liveNames = await Promise.all(
        driveIds.map(async (fid) => {
          try {
            const r = await drive.files.get({
              fileId: fid,
              fields: 'name',
              supportsAllDrives: true,
            });
            return r.data.name?.trim() ?? '';
          } catch {
            return '';
          }
        }),
      );
      idx = resolveReviewFolderFileSourceIndex(
        fileId,
        driveFileName,
        assetIds,
        driveIds,
        (assetRows ?? []) as AssetNameRow[],
        liveNames,
      );
    }

    if (idx === -1) {
      return NextResponse.json(
        {
          error:
            'Could not match this review file to a source asset (filename mismatch). Check Debug tab for source_asset_ids.',
        },
        { status: 422 },
      );
    }

    // Review folder holds copies only; remove the copy from Drive. Do not delete content_assets (library registry).
    await drive.files.delete({ fileId, supportsAllDrives: true });

    const nextDriveIds = driveIds.filter((_, i) => i !== idx);
    const nextAssetIds = assetIds.filter((_, i) => i !== idx);
    const removedAssetId = assetIds[idx] ?? '';

    const rowTyped = row as {
      post_type?: string | null;
      story_frames?: unknown;
      carousel_slides?: unknown;
    };
    const structurePatch = pruneCandidateStructureForRemovedAsset({
      postType: rowTyped.post_type,
      story_frames: rowTyped.story_frames,
      carousel_slides: rowTyped.carousel_slides,
      removedAssetId,
      removedIndex: idx,
      sourceAssetIdsLen: assetIds.length,
    });

    const now = new Date().toISOString();
    const { data: updated, error: updErr } = await supabase
      .from('post_candidates')
      .update({
        source_drive_file_ids: nextDriveIds,
        source_asset_ids: nextAssetIds,
        updated_at: now,
        ...structurePatch,
      })
      .eq('id', candidateId)
      .select()
      .maybeSingle();

    if (updErr) {
      console.error('[review-assets delete] candidate update', updErr);
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    if (!updated) {
      return NextResponse.json({ error: 'Candidate not found after update' }, { status: 404 });
    }

    return NextResponse.json({ candidate: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[review-assets delete]', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
