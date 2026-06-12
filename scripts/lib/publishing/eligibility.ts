import { isClipBasedReel } from './reel-publish.js';
import type {
  EligibilityResult,
  PostCandidateRow,
  PublishType,
  ResolvedMediaItem,
} from './types.js';

const PRODUCTION_MSG = 'Candidate requires production/rendering before Graph API prep.';

export type PublishingEligibilityContext = {
  /** When true, reel prep publishes the rendered MP4 (multi-source clip reels). */
  hasProducedReelRender?: boolean;
};

function carouselSlidesMissingAssets(slides: unknown): boolean {
  if (!Array.isArray(slides) || slides.length === 0) return false;
  for (const s of slides) {
    if (s == null || typeof s !== 'object') return true;
    const id = (s as Record<string, unknown>).asset_id;
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id.trim())) return true;
  }
  return false;
}

export function resolvePublishType(
  candidate: PostCandidateRow,
  resolved: ResolvedMediaItem[],
): PublishType | null {
  const t = candidate.post_type;
  if (t === 'carousel') return 'carousel';
  if (t === 'story_sequence') return 'story_sequence';
  if (t === 'reel') return 'reel';
  if (t === 'static_post') {
    if (resolved.length !== 1) return null;
    const m = resolved[0]!.media_type;
    if (m === 'video') return 'video';
    if (m === 'image') return 'image';
    return null;
  }
  return null;
}

/**
 * Structural gates from planner JSON + resolved registry media kinds.
 * Caller still validates counts (e.g. reel must be single video).
 */
export function assessPublishingEligibility(
  candidate: PostCandidateRow,
  resolved: ResolvedMediaItem[],
  ctx?: PublishingEligibilityContext,
): EligibilityResult {
  const pt = candidate.post_type;

  if (pt === 'sponsor_post' || pt === 'archive_note') {
    return { ok: false, reason: PRODUCTION_MSG };
  }

  if (pt === 'carousel' && carouselSlidesMissingAssets(candidate.carousel_slides)) {
    return { ok: false, reason: PRODUCTION_MSG };
  }

  if (resolved.length === 0) {
    return { ok: false, reason: 'No source media resolved for this candidate.' };
  }

  const publishType = resolvePublishType(candidate, resolved);
  if (!publishType) {
    return { ok: false, reason: PRODUCTION_MSG };
  }

  const badKind = resolved.some((r) => r.media_type !== 'image' && r.media_type !== 'video');
  if (badKind) {
    return { ok: false, reason: 'Resolved assets include non-image/non-video media.' };
  }

  if (publishType === 'carousel') {
    if (resolved.length < 2) {
      return { ok: false, reason: 'Carousel requires at least two media items.' };
    }
    if (resolved.length > 10) {
      return { ok: false, reason: 'Carousel exceeds Instagram item limit (10).' };
    }
  }

  if (publishType === 'reel') {
    const clipReel = isClipBasedReel(candidate);
    if (clipReel && !ctx?.hasProducedReelRender) {
      return {
        ok: false,
        reason: 'Clip-based reel must finish rendering before publishing prep.',
      };
    }
    if (!ctx?.hasProducedReelRender) {
      if (resolved.length !== 1 || resolved[0]!.media_type !== 'video') {
        return { ok: false, reason: 'Reel publishing prep supports a single video asset only.' };
      }
    }
  }

  if (publishType === 'image' || publishType === 'video') {
    if (resolved.length !== 1) {
      return { ok: false, reason: PRODUCTION_MSG };
    }
  }

  return { ok: true, publishType };
}
