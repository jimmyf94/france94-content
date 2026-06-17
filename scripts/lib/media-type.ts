export function inferMediaType(mimeType: string | null | undefined): string {
  const m = mimeType ?? '';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('text/') || m === 'application/pdf') return 'text';
  return 'other';
}
