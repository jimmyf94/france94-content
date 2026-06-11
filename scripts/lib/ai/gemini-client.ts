import {
  GoogleGenAI,
  type ContentListUnion,
  type GenerateContentConfig,
  type GenerateContentResponse,
} from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Agent, fetch as undiciFetch } from 'undici';

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

/** Initial attempt plus 2 retries on high-demand 503 / transient fetch errors. */
const HIGH_DEMAND_503_MAX_ATTEMPTS = 3;

const DEFAULT_GEMINI_HTTP_TIMEOUT_MS = 600_000;

function geminiHttpTimeoutMs(): number {
  const raw = process.env.FR94_GEMINI_HTTP_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_GEMINI_HTTP_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_GEMINI_HTTP_TIMEOUT_MS;
}

let fetchPatchTimeoutMs = 0;
let nativeFetch: typeof globalThis.fetch | null = null;

function resolveFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Node fetch defaults to ~300s Undici headers timeout. Route all Gemini traffic
 * (generate calls and resumable uploads) through one undici stack so uploads
 * with manual Content-Length headers do not cross Node's native fetch + a
 * standalone undici Agent (which throws UND_ERR_INVALID_ARG on Node 25).
 */
function ensureGeminiFetchPatch(ms: number): void {
  if (fetchPatchTimeoutMs >= ms && nativeFetch != null) return;

  if (nativeFetch == null) {
    nativeFetch = globalThis.fetch.bind(globalThis);
  }

  const longAgent = new Agent({
    connectTimeout: 60_000,
    headersTimeout: ms,
    bodyTimeout: ms,
    keepAliveTimeout: 10_000,
    keepAliveMaxTimeout: 60_000,
  });

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveFetchUrl(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      return undiciFetch(input, { ...init, dispatcher: longAgent } as Parameters<typeof undiciFetch>[1]);
    }
    return nativeFetch!(input, init);
  }) as typeof fetch;

  fetchPatchTimeoutMs = ms;
}

/** Shared Gemini client with a generous HTTP timeout for slow planner responses. */
export function createGeminiClient(apiKey: string): GoogleGenAI {
  const timeout = geminiHttpTimeoutMs();
  ensureGeminiFetchPatch(timeout);
  return new GoogleGenAI({
    apiKey,
    httpOptions: { timeout },
  });
}

function debug(msg: string): void {
  if (geminiCacheDebug()) console.warn(`[gemini_cache] ${msg}`);
}

function info(msg: string): void {
  console.log(`[gemini] ${msg}`);
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

/** Network timeouts and other retryable transport failures. */
export function isGeminiTransientFetchError(e: unknown): boolean {
  if (isGeminiHighDemand503(e)) return true;
  const t = errorText(e).toLowerCase();
  if (t.includes('fetch failed')) return true;
  if (t.includes('headerstimeouterror') || t.includes('headers timeout')) return true;
  if (t.includes('econnreset') || t.includes('etimedout') || t.includes('socket hang up')) {
    return true;
  }
  const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
  if (cause?.code === 'UND_ERR_HEADERS_TIMEOUT') return true;
  if (cause?.message?.toLowerCase().includes('headers timeout')) return true;
  return false;
}

export function formatGeminiFetchError(e: unknown): string {
  const parts: string[] = [];
  if (e instanceof Error) {
    parts.push(`${e.name}: ${e.message}`);
    const cause = (e as { cause?: unknown }).cause;
    if (cause instanceof Error) {
      parts.push(`cause: ${cause.name} ${cause.message}`);
      const code = (cause as { code?: string }).code;
      if (code) parts.push(`cause_code: ${code}`);
    } else if (cause != null) {
      parts.push(`cause: ${String(cause)}`);
    }
  } else {
    parts.push(String(e));
  }
  return parts.join(' | ');
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
      if (!isGeminiTransientFetchError(e)) throw e;
      if (attempt < HIGH_DEMAND_503_MAX_ATTEMPTS - 1) {
        const reason = isGeminiHighDemand503(e) ? '503/high-demand' : 'transient fetch';
        info(
          `generateContent ${reason} retry ${attempt + 1}/${HIGH_DEMAND_503_MAX_ATTEMPTS - 1} model=${primaryModel}: ${formatGeminiFetchError(e)}`,
        );
        await sleep(1500 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  if (
    isGemini31ProFamilyModel(primaryModel) &&
    lastErr != null &&
    (isGeminiHighDemand503(lastErr) || isGeminiTransientFetchError(lastErr))
  ) {
    const reason = isGeminiHighDemand503(lastErr) ? '503' : 'transient fetch/timeout';
    info(
      `generateContent fallback model=${GEMINI_PRO_HIGH_DEMAND_FALLBACK_MODEL} after ${reason} on ${primaryModel}`,
    );
    debug(
      `generateContent using fallback model=${GEMINI_PRO_HIGH_DEMAND_FALLBACK_MODEL} after ${reason} on ${primaryModel}`,
    );
    try {
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
    } catch (fallbackErr) {
      lastErr = fallbackErr;
    }
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
  if (!useExplicit && params.supabase != null && route.operation === 'candidate_generation') {
    info(
      `${route.operation} explicit_cache disabled (set GEMINI_ENABLE_EXPLICIT_CACHING=false to turn off)`,
    );
  }
  const started = Date.now();
  info(
    `${route.operation} start model=${model} http_timeout_ms=${geminiHttpTimeoutMs()} stable_chars=${params.stableSystemInstruction.length} cache_key=${params.cacheKey.slice(0, 64)}`,
  );

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
    info(`${route.operation} explicit_cache lookup cache_key=${params.cacheKey.slice(0, 64)}`);
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
      info(`${route.operation} explicit_cache ${cacheResult.path} name=${cacheResult.resourceName}`);
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
        info(
          `${route.operation} explicit_generate ok model=${modelUsed} latency_ms=${Date.now() - started}`,
        );
        return { response, modelUsed };
      } catch (e) {
        const msg = formatGeminiFetchError(e);
        info(`${route.operation} explicit_generate failed; fallback implicit (${msg})`);
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
    const cachePath = useExplicit ? 'implicit_fallback' : 'implicit';
    info(`${route.operation} ${cachePath}_generate start`);
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
    info(
      `${route.operation} ${useExplicit ? 'implicit_fallback' : 'implicit'}_generate ok model=${modelUsed} latency_ms=${Date.now() - started}`,
    );
    return { response, modelUsed };
  } catch (e) {
    const latency = Date.now() - started;
    const msg = formatGeminiFetchError(e);
    info(`${route.operation} generate failed latency_ms=${latency} error=${msg}`);
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
