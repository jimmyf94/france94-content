import type { drive_v3 } from 'googleapis';

export async function copyAssetToReviewFolder(
  drive: drive_v3.Drive,
  params: { sourceDriveFileId: string; destFolderId: string },
): Promise<{ copiedFileId: string; name: string }> {
  const sourceDriveFileId = params.sourceDriveFileId.trim();
  const destFolderId = params.destFolderId.trim();
  if (!sourceDriveFileId || !destFolderId) {
    throw new Error('Missing source drive file id or destination folder id');
  }

  const meta = await drive.files.get({
    fileId: sourceDriveFileId,
    fields: 'name',
    supportsAllDrives: true,
  });
  const name = meta.data.name?.trim();
  if (!name) {
    throw new Error('Drive file has no name');
  }

  const res = await drive.files.copy({
    fileId: sourceDriveFileId,
    supportsAllDrives: true,
    requestBody: {
      name,
      parents: [destFolderId],
    },
    fields: 'id, name',
  });

  const copiedFileId = res.data.id?.trim();
  if (!copiedFileId) {
    throw new Error('Drive copy returned no id');
  }

  return { copiedFileId, name: res.data.name?.trim() ?? name };
}
