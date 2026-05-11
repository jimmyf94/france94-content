import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadAudioTranscriptionStablePrompt,
  loadDirectMediaAnalysisStablePrompt,
  loadVideoSampledAnalysisStablePrompt,
} from './prompts/asset-analysis.js';
import { loadCandidateRegenerationStablePrompt } from './prompts/candidate-regeneration.js';
import { loadPostPlannerStablePrompt } from './prompts/post-planner.js';

export const STABLE_PROMPT_KEYS = [
  'direct_media_analysis',
  'video_sampled_analysis',
  'audio_transcription',
  'post_planner',
  'candidate_regeneration',
] as const;

export type StablePromptKey = (typeof STABLE_PROMPT_KEYS)[number];

function loadFromFile(key: StablePromptKey): string {
  switch (key) {
    case 'direct_media_analysis':
      return loadDirectMediaAnalysisStablePrompt();
    case 'video_sampled_analysis':
      return loadVideoSampledAnalysisStablePrompt();
    case 'audio_transcription':
      return loadAudioTranscriptionStablePrompt();
    case 'post_planner':
      return loadPostPlannerStablePrompt();
    case 'candidate_regeneration':
      return loadCandidateRegenerationStablePrompt();
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

export async function loadResolvedStablePrompt(
  supabase: SupabaseClient | null,
  key: StablePromptKey,
): Promise<{ text: string; source: 'db' | 'file' }> {
  if (!supabase) {
    return { text: loadFromFile(key), source: 'file' };
  }

  try {
    const { data, error } = await supabase
      .from('llm_stable_prompts')
      .select('body')
      .eq('prompt_key', key)
      .maybeSingle();

    if (error || !data || typeof data !== 'object') {
      return { text: loadFromFile(key), source: 'file' };
    }

    const body = (data as { body?: unknown }).body;
    if (typeof body !== 'string') {
      return { text: loadFromFile(key), source: 'file' };
    }

    const trimmed = body.trim();
    if (!trimmed) {
      return { text: loadFromFile(key), source: 'file' };
    }

    return { text: trimmed, source: 'db' };
  } catch {
    return { text: loadFromFile(key), source: 'file' };
  }
}
