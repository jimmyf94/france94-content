import type { ContentListUnion, GenerateContentConfig, GenerateContentResponse } from '@google/genai';
import type { GoogleGenAI } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getOrCreatePromptCache } from './gemini-cache.js';
import { logLlmCall } from './llm-logging.js';
import {
  explicitCachingEnabled,
  geminiCacheDebug,
  geminiCacheTtlSeconds,
} from './prompt-version.js';
import type { Fr94LlmOperation } from './types.js';

export type { Fr94LlmOperation } from './types.js';

function debug(msg: string): void {
  if (geminiCacheDebug()) console.warn(`[gemini_cache] ${msg}`);
}

export function responseToJson(raw: unknown): Record<string, unknown> {
  const r = raw as {
    text?: string;
    candidates?: unknown;
    usageMetadata?: unknown;
    promptFeedback?: unknown;
    modelVersion?: string;
    responseId?: string;
  };
  let cloned: Record<string, unknown> = {};
  try {
    cloned = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  } catch {
    cloned = {};
  }
  return {
    ...cloned,
    text: r.text,
    candidates: r.candidates,
    usageMetadata: r.usageMetadata,
    promptFeedback: r.promptFeedback,
    modelVersion: r.modelVersion,
    responseId: r.responseId,
  };
}

function usageSnapshot(usage: GenerateContentResponse['usageMetadata']) {
  return {
    cachedContentTokenCount: usage?.cachedContentTokenCount ?? null,
    inputTokenCount: usage?.promptTokenCount ?? null,
    outputTokenCount: usage?.candidatesTokenCount ?? null,
    totalTokenCount: usage?.totalTokenCount ?? null,
  };
}

export async function callGeminiWithLogging(params: {
  ai: GoogleGenAI;
  supabase: SupabaseClient | null;
  operation: Fr94LlmOperation;
  subOperation?: string;
  model: string;
  promptVersion: string;
  cacheKey: string;
  stableSystemInstruction: string;
  getContentsImplicit: () => ContentListUnion;
  getContentsExplicit: () => ContentListUnion;
  config: Omit<GenerateContentConfig, 'cachedContent'>;
  /** When true, never uses Gemini explicit context caches (e.g. prompt path override). */
  disableExplicitCaching?: boolean;
}): Promise<GenerateContentResponse> {
  const ttlSeconds = geminiCacheTtlSeconds();
  const useExplicit =
    explicitCachingEnabled() &&
    params.supabase != null &&
    params.disableExplicitCaching !== true;
  const started = Date.now();

  const baseMeta: Record<string, unknown> = {
    sub_operation: params.subOperation ?? null,
    cache_key: params.cacheKey,
  };

  if (useExplicit && params.stableSystemInstruction.trim()) {
    const cacheResult = await getOrCreatePromptCache({
      ai: params.ai,
      supabase: params.supabase!,
      cacheKey: params.cacheKey,
      model: params.model,
      stableSystemInstruction: params.stableSystemInstruction,
      ttlSeconds,
      promptVersion: params.promptVersion,
    });

    if (cacheResult) {
      try {
        const response = await params.ai.models.generateContent({
          model: params.model,
          contents: params.getContentsExplicit(),
          config: {
            ...params.config,
            cachedContent: cacheResult.resourceName,
          },
        });
        const latency = Date.now() - started;
        const u = usageSnapshot(response.usageMetadata);
        await logLlmCall(params.supabase, {
          operation: params.operation,
          model: params.model,
          prompt_version: params.promptVersion,
          cache_key: params.cacheKey,
          cache_resource_name: cacheResult.resourceName,
          explicit_cache_enabled: true,
          cached_content_token_count: u.cachedContentTokenCount,
          input_token_count: u.inputTokenCount,
          output_token_count: u.outputTokenCount,
          total_token_count: u.totalTokenCount,
          latency_ms: latency,
          success: true,
          error_message: null,
          metadata: {
            ...baseMeta,
            cache_path: cacheResult.path,
            usageMetadata: response.usageMetadata,
          },
        });
        return response;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        debug(`explicit generateContent failed; fallback implicit (${msg})`);
        const latency = Date.now() - started;
        await logLlmCall(params.supabase, {
          operation: params.operation,
          model: params.model,
          prompt_version: params.promptVersion,
          cache_key: params.cacheKey,
          cache_resource_name: cacheResult.resourceName,
          explicit_cache_enabled: true,
          cached_content_token_count: null,
          input_token_count: null,
          output_token_count: null,
          total_token_count: null,
          latency_ms: latency,
          success: false,
          error_message: msg,
          metadata: { ...baseMeta, phase: 'explicit_generate', cache_path: cacheResult.path },
        });
      }
    }
  }

  try {
    const response = await params.ai.models.generateContent({
      model: params.model,
      contents: params.getContentsImplicit(),
      config: params.config,
    });
    const latency = Date.now() - started;
    const u = usageSnapshot(response.usageMetadata);
    await logLlmCall(params.supabase, {
      operation: params.operation,
      model: params.model,
      prompt_version: params.promptVersion,
      cache_key: params.cacheKey,
      cache_resource_name: null,
      explicit_cache_enabled: false,
      cached_content_token_count: u.cachedContentTokenCount,
      input_token_count: u.inputTokenCount,
      output_token_count: u.outputTokenCount,
      total_token_count: u.totalTokenCount,
      latency_ms: latency,
      success: true,
      error_message: null,
      metadata: {
        ...baseMeta,
        cache_path: useExplicit ? 'implicit_fallback' : 'implicit',
        usageMetadata: response.usageMetadata,
      },
    });
    return response;
  } catch (e) {
    const latency = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    await logLlmCall(params.supabase, {
      operation: params.operation,
      model: params.model,
      prompt_version: params.promptVersion,
      cache_key: params.cacheKey,
      cache_resource_name: null,
      explicit_cache_enabled: false,
      cached_content_token_count: null,
      input_token_count: null,
      output_token_count: null,
      total_token_count: null,
      latency_ms: latency,
      success: false,
      error_message: msg,
      metadata: { ...baseMeta, cache_path: 'implicit' },
    });
    throw e;
  }
}
