const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

type CacheEntry = { jpeg: Buffer; at: number };

const thumbnailCache = new Map<string, CacheEntry>();

function cacheKey(kind: 'asset' | 'clip', id: string): string {
  return `${kind}:${id.trim()}`;
}

export function getCachedStoredThumbnail(kind: 'asset' | 'clip', id: string): Buffer | null {
  const hit = thumbnailCache.get(cacheKey(kind, id));
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    thumbnailCache.delete(cacheKey(kind, id));
    return null;
  }
  return hit.jpeg;
}

export function setCachedStoredThumbnail(kind: 'asset' | 'clip', id: string, jpeg: Buffer): void {
  if (thumbnailCache.size >= MAX_ENTRIES) {
    const oldest = thumbnailCache.keys().next().value;
    if (oldest) thumbnailCache.delete(oldest);
  }
  thumbnailCache.set(cacheKey(kind, id), { jpeg, at: Date.now() });
}
