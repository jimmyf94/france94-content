import type { PostCandidateRow } from './types.js';

function normalizeHashtag(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return t.startsWith('#') ? t : `#${t}`;
}

/** caption_fr + blank line + hashtags as #foo #bar; optional caption_en when clearly intentional. */
export function buildPublishingCaption(candidate: PostCandidateRow): string {
  const fr = (candidate.caption_fr ?? '').trim();
  const tags = Array.isArray(candidate.hashtags)
    ? candidate.hashtags.map((t) => normalizeHashtag(String(t))).filter(Boolean)
    : [];
  const tagLine = tags.join(' ');

  const enRaw = (candidate.caption_en ?? '').trim();
  let body = fr;
  if (enRaw) {
    const distinct =
      enRaw.length >= 12 &&
      !fr.toLowerCase().includes(enRaw.slice(0, 40).toLowerCase()) &&
      !enRaw.toLowerCase().includes(fr.slice(0, 40).toLowerCase());
    if (distinct) {
      body = `${fr}\n\n${enRaw}`;
    }
  }

  if (tagLine) {
    return body ? `${body}\n\n${tagLine}` : tagLine;
  }
  return body;
}
