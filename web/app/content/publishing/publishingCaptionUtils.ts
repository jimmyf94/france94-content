export function parseHashtagInput(raw: string): string[] {
  const parts = raw.split(/[\n,]+/);
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim().replace(/^#+/, '');
    if (t) out.push(t);
  }
  return out;
}

export function hashtagsToInput(hashtags: string[] | null | undefined): string {
  return (hashtags ?? [])
    .map((h) => (String(h).startsWith('#') ? String(h).slice(1) : String(h)))
    .join('\n');
}

export function truncateInstagramCaption(raw: string): string {
  const max = 2200;
  const t = raw.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}
