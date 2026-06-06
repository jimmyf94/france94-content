import {
  assetImageStillUrl,
  assetStoredThumbnailUrl,
  assetVideoPosterUrl,
  isImageMime,
  isVideoMime,
} from '@/lib/asset-media-urls';
import type { AssetListRow } from '@/lib/asset-library-types';
import { sizedDriveThumbnail } from '@/lib/drive-thumbnail';

const GRID_THUMB_WIDTH = 400;

export function enrichAssetListRow(
  row: Omit<AssetListRow, 'thumbnail_link' | 'poster_url' | 'still_url'> & {
    thumbnail_link?: string | null;
    thumbnail_path?: string | null;
  },
  driveThumb: string | null,
): AssetListRow {
  const mime = row.mime_type ?? '';
  const mediaType = (row.media_type ?? '').toLowerCase();
  const isVideo = isVideoMime(mime) || mediaType === 'video';
  const isImage = isImageMime(mime) || mediaType === 'image';

  const storedPath = row.thumbnail_path?.trim();
  const thumbnail_link = storedPath
    ? assetStoredThumbnailUrl(row.id)
    : sizedDriveThumbnail(driveThumb, GRID_THUMB_WIDTH);
  const poster_url = isVideo ? assetVideoPosterUrl(row.id) : null;
  const still_url = isImage && !thumbnail_link ? assetImageStillUrl(row.id) : null;

  return {
    ...row,
    thumbnail_link,
    poster_url,
    still_url,
  };
}
