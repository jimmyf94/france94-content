export type PostTypeKey = 'reel' | 'carousel' | 'story_sequence' | 'static_post' | 'other';

export function postTypeKey(type: string): PostTypeKey {
  const t = type.trim();
  if (t === 'reel' || t === 'carousel' || t === 'story_sequence' || t === 'static_post') {
    return t;
  }
  return 'other';
}

export function formatPostTypeLabel(type: string): string {
  return type.replace(/_/g, ' ');
}
