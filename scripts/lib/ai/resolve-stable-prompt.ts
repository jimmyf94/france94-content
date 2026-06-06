import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadAudioTranscriptionStablePrompt,
  loadDirectMediaAnalysisStablePrompt,
  loadVideoSampledAnalysisStablePrompt,
} from './prompts/asset-analysis.js';
import {
  STABLE_CONTEXT_KEYS,
  TASK_PROMPT_KEYS,
  composeStableSystemInstruction,
  loadStableContextFromFile,
  loadTaskPromptFromFile,
  type StableContextKey,
  type TaskPromptKey,
} from './prompts/composed-context.js';

/** Asset-analysis single-file prompts (scripts/prompts/*.txt). */
export const ANALYSIS_STABLE_PROMPT_KEYS = [
  'direct_media_analysis',
  'video_sampled_analysis',
  'audio_transcription',
] as const;

export const STABLE_PROMPT_KEYS = [
  ...ANALYSIS_STABLE_PROMPT_KEYS,
  ...STABLE_CONTEXT_KEYS,
  ...TASK_PROMPT_KEYS,
] as const;

export type StablePromptKey = (typeof STABLE_PROMPT_KEYS)[number];

export {
  STABLE_CONTEXT_KEYS,
  TASK_PROMPT_KEYS,
  composeStableSystemInstruction,
} from './prompts/composed-context.js';
export type { StableContextKey, TaskPromptKey } from './prompts/composed-context.js';

function isContextKey(key: StablePromptKey): key is StableContextKey {
  return (STABLE_CONTEXT_KEYS as readonly string[]).includes(key);
}

function isTaskKey(key: StablePromptKey): key is TaskPromptKey {
  return (TASK_PROMPT_KEYS as readonly string[]).includes(key);
}

function loadFromFile(key: StablePromptKey): string {
  switch (key) {
    case 'direct_media_analysis':
      return loadDirectMediaAnalysisStablePrompt();
    case 'video_sampled_analysis':
      return loadVideoSampledAnalysisStablePrompt();
    case 'audio_transcription':
      return loadAudioTranscriptionStablePrompt();
    default:
      if (isContextKey(key)) return loadStableContextFromFile(key);
      if (isTaskKey(key)) return loadTaskPromptFromFile(key);
      throw new Error(`Unknown stable prompt key: ${String(key)}`);
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

/**
 * Compose stable context (user_voice + mission + content_lanes + editorial_rules)
 * plus a task prompt into a single Gemini `systemInstruction`. Each piece is
 * loaded with DB-override behavior via `loadResolvedStablePrompt`.
 */
export async function loadComposedStableSystemInstruction(
  supabase: SupabaseClient | null,
  taskKey: TaskPromptKey,
): Promise<{ text: string; parts: Array<{ key: StablePromptKey; source: 'db' | 'file' }> }> {
  const keys: StablePromptKey[] = [...STABLE_CONTEXT_KEYS, taskKey];
  const resolved = await Promise.all(
    keys.map(async (key) => {
      const r = await loadResolvedStablePrompt(supabase, key);
      return { key, source: r.source, text: r.text };
    }),
  );
  return {
    text: composeStableSystemInstruction(resolved.map((r) => r.text)),
    parts: resolved.map(({ key, source }) => ({ key, source })),
  };
}
