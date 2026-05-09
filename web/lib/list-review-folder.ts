import type { drive_v3 } from 'googleapis';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

const LIST_FIELDS =
  'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink, thumbnailLink, parents)';

export async function listReviewFolderFiles(
  drive: drive_v3.Drive,
  folderId: string,
): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: LIST_FIELDS,
      pageSize: 100,
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

export function mapDriveFileToReviewDto(f: drive_v3.Schema$File) {
  return {
    id: f.id ?? '',
    name: f.name ?? '',
    mimeType: f.mimeType ?? '',
    thumbnailLink: f.thumbnailLink ?? null,
    webViewLink: f.webViewLink ?? null,
    webContentLink: f.webContentLink ?? null,
    size: f.size ?? null,
    createdTime: f.createdTime ?? null,
    modifiedTime: f.modifiedTime ?? null,
  };
}
