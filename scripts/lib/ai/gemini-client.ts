import type { ContentListUnion, GenerateContentConfig, GenerateContentResponse, GoogleGenAI } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getOrCreatePromptCache } from './gemini-cache.js';
import { logLlmCall, type LlmCallEntityTag } from './llm-logging.js';
import type { ResolvedModelRoute } from './model-routes.js';
import {
  explicitCachingEnabled,
  geminiCacheDebug,
  geminiCacheTtlSeconds,
} from './prompt-version.js';

export type { LlmCallEntityTag } from './llm-logging.js';
export type { Fr94ModelRouteKey, ResolvedModelRoute } from './model-routes.js';
export {
  FR94_MODEL_ROUTE_KEYS,
  GEMINI_MODEL_PRICING_USD_PER_1M,
  estimateLlmCostUsd,
  getModelRoute,
  resolveModelPricingUsdPer1M,
  ThinkingLevel,
} from './model-routes.js';
export type { ModelPricingUsdPer1M } from './model-routes.js';
export {
  getResolvedModelRoute,
  mergeResolvedRouteForPreview,
  thinkingLevelFromDb,
  thinkingLevelToDb,
} from './model-route-resolve.js';
export type { LlmRouteSettingsRow } from './model-route-resolve.js';
export { stablePromptCacheSuffix } from './prompt-fingerprint.js';
export {
  ANALYSIS_STABLE_PROMPT_KEYS,
  STABLE_CONTEXT_KEYS,
  STABLE_PROMPT_KEYS,
  TASK_PROMPT_KEYS,
  composeStableSystemInstruction,
  loadComposedStableSystemInstruction,
  loadResolvedStablePrompt,
} from './resolve-stable-prompt.js';
export type {
  StableContextKey,
  StablePromptKey,
  TaskPromptKey,
} from './resolve-stable-prompt.js';

/** After 2 retries on 503, used when primary is Gemini 3.1 Pro (preview) and still overloaded. */
export const GEMINI_PRO_HIGH_DEMAND_FALLBACK_MODEL = 'gemini-2.5-pro';

/** Initial attempt plus 2 retries on high-demand 503. */
const HIGH_DEMAND_503_MAX_ATTEMPTS = 3;

function debug(msg: string): void {
  if (geminiCacheDebug()) console.warn(`[gemini_cache] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name} ${e.message}`;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * Detects 503 / UNAVAILABLE from Gemini (e.g. "high demand" on gemini-3.1-pro-preview).
 */
export function isGeminiHighDemand503(e: unknown): boolean {
  const t = errorText(e).toLowerCase();
  if (t.includes('"code":503') || t.includes('"code": 503')) return true;
  if (/\b503\b/.test(t) && (t.includes('unavailable') || t.includes('high demand'))) return true;
  const any = e as { status?: number; code?: number; error?: { code?: number } };
  const code = any?.status ?? any?.code ?? any?.error?.code;
  return code === 503;
}

function isGemini31ProFamilyModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.includes('flash')) return false;
  return m.includes('3.1') && m.includes('pro');
}

function stripCachedContent(c: GenerateContentConfig): GenerateContentConfig {
  const { cachedContent: _omit, ...rest } = c;
  return rest;
}

async function modelsGenerateWith503RetriesAndProFallback(
  ai: GoogleGenAI,
  params: {
    primaryModel: string;
    contents: ContentListUnion;
    config: GenerateContentConfig;
  },
): Promise<{ response: GenerateContentResponse; modelUsed: string; usedHighDemandFallback: boolean }> {
  const { primaryModel, contents, config } = params;
  let lastErr: unknown;

  for (let attempt = 0; attempt < HIGH_DEMAND_503_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: primaryModel,
        contents,
        config,
      });
      return { response, modelUsed: primaryModel, usedHighDemandFallback: false };
    } catch (e) {
      lastErr = e;
      if (!isGeminiHighDemand503(e)) throw e;
      if (attempt < HIGH_DEMAND_503_MAX_ATTEMPTS - 1) {
        debug(
          `generateContent 503/high-demand retry ${attempt + 1}/${HIGH_DEMAND_503_MAX_ATTEMPTS - 1} model=${primaryModel}`,
        );
        await sleep(800 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  if (
    isGemini31ProFamilyModel(primaryModel) &&
    lastErr != null &&
    isGeminiHighDemand503(lastErr)
  ) {
    debug(
      `generateContent using fallback model=${GEMINI_PRO_HIGH_DEMAND_FALLBACK_MODEL} after 503 on ${primaryModel}`,
    );
    const response = await ai.models.generateContent({
      model: GEMINI_PRO_HIGH_DEMAND_FALLBACK_MODEL,
      contents,
      config: stripCachedContent(config),
    });
    return {
      response,
      modelUsed: GEMINI_PRO_HIGH_DEMAND_FALLBACK_MODEL,
      usedHighDemandFallback: true,
    };
  }

  throw lastErr;
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

function routeMetadataSnapshot(route: ResolvedModelRoute): Record<string, unknown> {
  return {
    temperature: route.temperature,
    maxOutputTokens: route.maxOutputTokens,
    useCache: route.useCache,
    requireJson: route.requireJson,
    thinkingLevel: route.thinkingLevel,
  };
}

function buildGenerateConfig(
  route: ResolvedModelRoute,
  jsonResponse: boolean,
): Omit<GenerateContentConfig, 'cachedContent'> {
  const config: Omit<GenerateContentConfig, 'cachedContent'> = {
    temperature: route.temperature,
    maxOutputTokens: route.maxOutputTokens,
  };
  if (jsonResponse) {
    config.responseMimeType = 'application/json';
  }
  if (route.thinkingLevel != null) {
    config.thinkingConfig = { thinkingLevel: route.thinkingLevel };
  }
  return config;
}

export async function callGeminiWithLogging(params: {
  ai: GoogleGenAI;
  supabase: SupabaseClient | null;
  route: ResolvedModelRoute;
  subOperation?: string;
  promptVersion: string;
  cacheKey: string;
  stableSystemInstruction: string;
  getContentsImplicit: () => ContentListUnion;
  getContentsExplicit: () => ContentListUnion;
  /**
   * When unset, uses route.requireJson for responseMimeType.
   * Set false for plain-text outputs (e.g. audio transcription) while keeping the same model route.
   */
  jsonResponse?: boolean;
  /** When true, never uses Gemini explicit context caches (e.g. custom prompt path). */
  disableExplicitCaching?: boolean;
  /** Stored in llm_call_logs.metadata for per-candidate / per-asset pipeline tracing. */
  entity?: LlmCallEntityTag;
}): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  const { route } = params;
  const model = route.model;
  const jsonResponse = params.jsonResponse ?? route.requireJson;
  const config = buildGenerateConfig(route, jsonResponse);

  const disableExplicitCaching =
    params.disableExplicitCaching === true || !route.useCache;

  const ttlSeconds = geminiCacheTtlSeconds();
  const useExplicit =
    explicitCachingEnabled() &&
    params.supabase != null &&
    disableExplicitCaching !== true;
  const started = Date.now();

  const baseMeta: Record<string, unknown> = {
    sub_operation: params.subOperation ?? null,
    cache_key: params.cacheKey,
    model_route_operation: route.operation,
    model_overridden_from_env: route.modelOverriddenFromEnv,
    route: routeMetadataSnapshot(route),
    ...(params.entity?.post_candidate_id
      ? { post_candidate_id: params.entity.post_candidate_id }
      : {}),
    ...(params.entity?.content_asset_id
      ? { content_asset_id: params.entity.content_asset_id }
      : {}),
    ...(params.entity?.prompt_keys?.length ? { prompt_keys: params.entity.prompt_keys } : {}),
    ...(params.entity?.pipeline_step ? { pipeline_step: params.entity.pipeline_step } : {}),
  };

  if (useExplicit && params.stableSystemInstruction.trim()) {
    const cacheResult = await getOrCreatePromptCache({
      ai: params.ai,
      supabase: params.supabase!,
      cacheKey: params.cacheKey,
      model,
      stableSystemInstruction: params.stableSystemInstruction,
      ttlSeconds,
      promptVersion: params.promptVersion,
    });

    if (cacheResult) {
      try {
        const explicitConfig: GenerateContentConfig = {
          ...config,
          cachedContent: cacheResult.resourceName,
        };
        const { response, modelUsed, usedHighDemandFallback } =
          await modelsGenerateWith503RetriesAndProFallback(params.ai, {
            primaryModel: model,
            contents: params.getContentsExplicit(),
            config: explicitConfig,
          });
        const latency = Date.now() - started;
        const u = usageSnapshot(response.usageMetadata);
        await logLlmCall(params.supabase, {
          operation: route.operation,
          model: modelUsed,
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
            routed_primary_model: model,
            high_demand_503_fallback: usedHighDemandFallback,
          },
        });
        return { response, modelUsed };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        debug(`explicit generateContent failed; fallback implicit (${msg})`);
        const latency = Date.now() - started;
        await logLlmCall(params.supabase, {
          operation: route.operation,
          model,
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
    const implicitConfig: GenerateContentConfig = config;
    const { response, modelUsed, usedHighDemandFallback } =
      await modelsGenerateWith503RetriesAndProFallback(params.ai, {
        primaryModel: model,
        contents: params.getContentsImplicit(),
        config: implicitConfig,
      });
    const latency = Date.now() - started;
    const u = usageSnapshot(response.usageMetadata);
    await logLlmCall(params.supabase, {
      operation: route.operation,
      model: modelUsed,
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
        routed_primary_model: model,
        high_demand_503_fallback: usedHighDemandFallback,
      },
    });
    return { response, modelUsed };
  } catch (e) {
    const latency = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    await logLlmCall(params.supabase, {
      operation: route.operation,
      model,
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
