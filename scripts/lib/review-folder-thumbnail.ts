import type { drive_v3 } from 'googleapis';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

const THUMB_LIST_FIELDS = 'nextPageToken, files(id, mimeType, thumbnailLink)';

export async function getDriveFileThumbnailLink(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<string | null> {
  const id = fileId.trim();
  if (!id) return null;
  try {
    const res = await drive.files.get({
      fileId: id,
      fields: 'thumbnailLink',
      supportsAllDrives: true,
    });
    return res.data.thumbnailLink?.trim() || null;
  } catch {
    return null;
  }
}

/** First Drive file id in the list that returns a thumbnailLink (files.get per id). */
export async function getThumbnailFromDriveFileIds(
  drive: drive_v3.Drive,
  fileIds: string[],
): Promise<string | null> {
  const seen = new Set<string>();
  for (const raw of fileIds) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const link = await getDriveFileThumbnailLink(drive, id);
    if (link) return link;
  }
  return null;
}

async function listFolderFilesForThumbs(
  drive: drive_v3.Drive,
  folderId: string,
): Promise<Array<{ id?: string | null; mimeType?: string | null; thumbnailLink?: string | null }>> {
  const out: Array<{ id?: string | null; mimeType?: string | null; thumbnailLink?: string | null }> =
    [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: THUMB_LIST_FIELDS,
      pageSize: 25,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const f of res.data.files ?? []) {
      if (f.mimeType === FOLDER_MIME) continue;
      out.push(f);
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return out;
}

/** First non-folder file in a review folder that exposes a Drive thumbnailLink. */
export async function getFirstReviewFolderThumbnailLink(
  drive: drive_v3.Drive,
  folderId: string,
  options?: { fallbackDriveFileIds?: string[] },
): Promise<string | null> {
  const files = await listFolderFilesForThumbs(drive, folderId);

  for (const f of files) {
    if (f.thumbnailLink) return f.thumbnailLink;
  }

  for (const f of files) {
    const id = f.id?.trim();
    if (!id) continue;
    const link = await getDriveFileThumbnailLink(drive, id);
    if (link) return link;
  }

  const fallbackIds = options?.fallbackDriveFileIds ?? [];
  if (fallbackIds.length > 0) {
    return getThumbnailFromDriveFileIds(drive, fallbackIds);
  }

  return null;
}

export function firstThumbnailFromDriveFiles(
  files: Array<{ mimeType?: string | null; thumbnailLink?: string | null }>,
): string | null {
  for (const f of files) {
    if (f.mimeType === FOLDER_MIME) continue;
    if (f.thumbnailLink) return f.thumbnailLink;
  }
  return null;
}
