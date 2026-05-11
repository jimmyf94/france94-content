import type { SupabaseClient } from '@supabase/supabase-js';

import type { Fr94ModelRouteKey } from './model-routes.js';
import { llmLoggingDisabled } from './prompt-version.js';

export type LlmCallLogRow = {
  provider?: string;
  model: string | null;
  operation: Fr94ModelRouteKey;
  prompt_version: string | null;
  cache_key: string | null;
  cache_resource_name: string | null;
  explicit_cache_enabled: boolean;
  cached_content_token_count: number | null;
  input_token_count: number | null;
  output_token_count: number | null;
  total_token_count: number | null;
  latency_ms: number | null;
  success: boolean;
  error_message: string | null;
  metadata?: Record<string, unknown>;
};

export async function logLlmCall(
  supabase: SupabaseClient | null,
  row: LlmCallLogRow,
): Promise<void> {
  if (!supabase || llmLoggingDisabled()) return;
  try {
    const { error } = await supabase.from('llm_call_logs').insert({
      provider: row.provider ?? 'gemini',
      model: row.model,
      operation: row.operation,
      prompt_version: row.prompt_version,
      cache_key: row.cache_key,
      cache_resource_name: row.cache_resource_name,
      explicit_cache_enabled: row.explicit_cache_enabled,
      cached_content_token_count: row.cached_content_token_count,
      input_token_count: row.input_token_count,
      output_token_count: row.output_token_count,
      total_token_count: row.total_token_count,
      latency_ms: row.latency_ms,
      success: row.success,
      error_message: row.error_message,
      metadata: row.metadata ?? null,
    });
    if (error) {
      console.warn(`[llm_call_logs] insert failed: ${error.message}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[llm_call_logs] insert exception: ${msg}`);
  }
}
