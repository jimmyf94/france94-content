import { ThinkingLevel } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Fr94ModelRouteKey, ResolvedModelRoute } from './model-routes.js';
import { getModelRoute } from './model-routes.js';

export type LlmRouteSettingsRow = {
  operation: string;
  model: string;
  temperature: number;
  max_output_tokens: number;
  use_cache: boolean;
  require_json: boolean;
  thinking_level: string | null;
  updated_at?: string;
};

export function thinkingLevelFromDb(raw: string | null | undefined): ThinkingLevel | null {
  if (raw == null || raw === '') return null;
  const v = raw.trim() as ThinkingLevel;
  if ((Object.values(ThinkingLevel) as string[]).includes(v)) return v;
  return null;
}

export function thinkingLevelToDb(level: ThinkingLevel | null): string | null {
  if (level == null) return null;
  return String(level);
}

function mergeBaseWithRow(base: ResolvedModelRoute, row: LlmRouteSettingsRow): ResolvedModelRoute {
  const thinkingLevel = thinkingLevelFromDb(row.thinking_level);
  return {
    operation: base.operation,
    model: base.modelOverriddenFromEnv ? base.model : row.model,
    temperature: row.temperature,
    maxOutputTokens: row.max_output_tokens,
    useCache: row.use_cache,
    requireJson: row.require_json,
    thinkingLevel: thinkingLevel ?? null,
    modelOverriddenFromEnv: base.modelOverriddenFromEnv,
  };
}

export async function getResolvedModelRoute(
  supabase: SupabaseClient | null,
  operation: Fr94ModelRouteKey,
): Promise<ResolvedModelRoute> {
  const base = getModelRoute(operation);
  if (!supabase) return base;

  try {
    const { data, error } = await supabase
      .from('llm_route_settings')
      .select(
        'operation, model, temperature, max_output_tokens, use_cache, require_json, thinking_level, updated_at',
      )
      .eq('operation', operation)
      .maybeSingle();

    if (error || !data || typeof data !== 'object') return base;

    const row = data as LlmRouteSettingsRow;
    if (!row.model || typeof row.temperature !== 'number') return base;

    return mergeBaseWithRow(base, row);
  } catch {
    return base;
  }
}

export function mergeResolvedRouteForPreview(
  base: ResolvedModelRoute,
  row: LlmRouteSettingsRow,
): ResolvedModelRoute {
  return mergeBaseWithRow(base, row);
}
