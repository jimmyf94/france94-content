export function sanitizeFilenamePart(raw: string | null | undefined, maxLen: number): string {
  if (!raw?.trim()) return 'unknown';
  const asciiFold = raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  const slug = asciiFold
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) return 'unknown';
  return slug.length <= maxLen ? slug : slug.slice(0, maxLen).replace(/-+$/g, '') || 'unknown';
}
