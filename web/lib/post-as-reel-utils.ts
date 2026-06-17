export function isVideoAsset(row: {
  mime_type?: string | null;
  media_type?: string | null;
}): boolean {
  const mime = (row.mime_type ?? '').toLowerCase();
  const media = (row.media_type ?? '').toLowerCase();
  return mime.startsWith('video/') || media === 'video';
}

export function normalizeHashtags(raw: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const tag of raw ?? []) {
    const t = String(tag).trim().replace(/^#+/, '');
    if (t) out.push(t);
  }
  return out;
}

export function assetDisplayTitle(row: {
  final_filename?: string | null;
  current_filename?: string | null;
  original_filename?: string | null;
}): string {
  return (
    row.final_filename?.trim() ||
    row.current_filename?.trim() ||
    row.original_filename?.trim() ||
    'Library reel'
  );
}
