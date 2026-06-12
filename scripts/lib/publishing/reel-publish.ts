import type { SupabaseClient } from '@supabase/supabase-js';

import type { PostCandidateRow } from './types.js';

export type ReelTrialGraduationStrategy = 'MANUAL' | 'SS_PERFORMANCE';

export function isClipBasedReel(candidate: Pick<PostCandidateRow, 'reel_instructions'>): boolean {
  const ri = candidate.reel_instructions;
  if (ri == null || typeof ri !== 'object') return false;
  const o = ri as Record<string, unknown>;
  return o.version === 'clips-v1' && Array.isArray(o.clips) && o.clips.length > 0;
}

export function parseReelTrialGraduationStrategy(
  raw: unknown,
): ReelTrialGraduationStrategy | null {
  if (raw === 'MANUAL' || raw === 'SS_PERFORMANCE') return raw;
  return null;
}

/** Rendered reel output (public bucket URL) for a candidate, if production finished. */
export async function findProducedReelRender(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<{ url: string; durationSeconds: number | null } | null> {
  const { data, error } = await supabase
    .from('production_jobs')
    .select('output_video_url, render_log, status')
    .eq('post_candidate_id', candidateId)
    .eq('production_type', 'reel')
    .eq('status', 'produced')
    .maybeSingle();
  if (error || !data) return null;
  const url = typeof data.output_video_url === 'string' ? data.output_video_url.trim() : '';
  if (!url) return null;
  const log = (data.render_log ?? {}) as Record<string, unknown>;
  const dur = Number(log.duration_seconds);
  return { url, durationSeconds: Number.isFinite(dur) ? dur : null };
}
