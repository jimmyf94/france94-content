import { ThinkingLevel } from '@google/genai';

export { ThinkingLevel };

export const FR94_MODEL_ROUTE_KEYS = [
  'asset_analysis_image',
  'asset_analysis_video_sampled',
  'asset_analysis_video_full',
  'candidate_generation',
  'candidate_regeneration',
  'caption_rewrite_basic',
  'caption_rewrite_premium',
  'ranking',
  'final_editorial_pass',
  'collision_check',
] as const;

export type Fr94ModelRouteKey = (typeof FR94_MODEL_ROUTE_KEYS)[number];

export type ModelRouteDefaults = {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  useCache: boolean;
  requireJson: boolean;
  /** `null` disables Gemini thinking; otherwise passed as `thinkingConfig.thinkingLevel`. */
  thinkingLevel: ThinkingLevel | null;
};

export type ResolvedModelRoute = ModelRouteDefaults & {
  operation: Fr94ModelRouteKey;
  modelOverriddenFromEnv: boolean;
};

const DEFAULT_ROUTES: Record<Fr94ModelRouteKey, ModelRouteDefaults> = {
  asset_analysis_image: {
    model: 'gemini-3.1-flash-lite',
    temperature: 0.2,
    maxOutputTokens: 1200,
    useCache: true,
    requireJson: true,
    thinkingLevel: null,
  },
  asset_analysis_video_sampled: {
    model: 'gemini-3.1-flash-lite',
    temperature: 0.2,
    maxOutputTokens: 1500,
    useCache: true,
    requireJson: true,
    thinkingLevel: null,
  },
  asset_analysis_video_full: {
    model: 'gemini-3.1-pro-preview',
    temperature: 0.2,
    maxOutputTokens: 1800,
    useCache: true,
    requireJson: true,
    thinkingLevel: null,
  },
  candidate_generation: {
    model: 'gemini-3.1-pro-preview',
    temperature: 1.2,
    maxOutputTokens: 10000,
    useCache: true,
    requireJson: true,
    thinkingLevel: null,
  },
  candidate_regeneration: {
    model: 'gemini-3.1-pro-preview',
    temperature: 0.65,
    maxOutputTokens: 4000,
    useCache: true,
    requireJson: true,
    thinkingLevel: null,
  },
  caption_rewrite_basic: {
    model: 'gemini-3.1-flash-lite',
    temperature: 0.6,
    maxOutputTokens: 1500,
    useCache: true,
    requireJson: true,
    thinkingLevel: null,
  },
  caption_rewrite_premium: {
    model: 'gemini-3.1-pro-preview',
    temperature: 0.7,
    maxOutputTokens: 2500,
    useCache: true,
    requireJson: true,
    thinkingLevel: null,
  },
  ranking: {
    model: 'gemini-3.1-flash-lite',
    temperature: 0.1,
    maxOutputTokens: 1000,
    useCache: true,
    requireJson: true,
    thinkingLevel: null,
  },
  final_editorial_pass: {
    model: 'gemini-3.1-pro-preview',
    temperature: 0.45,
    maxOutputTokens: 2500,
    useCache: true,
    requireJson: true,
    thinkingLevel: null,
  },
  collision_check: {
    model: 'gemini-3.1-flash-lite-preview',
    temperature: 0.2,
    maxOutputTokens: 1500,
    useCache: false,
    requireJson: true,
    thinkingLevel: null,
  },
};

function envModelOverride(operation: Fr94ModelRouteKey): string | undefined {
  const envName = `FR94_MODEL_${operation.toUpperCase()}`;
  const v = process.env[envName]?.trim();
  return v && v.length > 0 ? v : undefined;
}

/** Standard-tier USD per 1M tokens (Google Gemini API, June 2026). */
export type ModelPricingUsdPer1M = {
  input: number;
  output: number;
};

/**
 * Static list prices for cost estimates in settings UI.
 * Unknown models return null from {@link estimateLlmCostUsd}.
 */
export const GEMINI_MODEL_PRICING_USD_PER_1M: Record<string, ModelPricingUsdPer1M> = {
  'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.5 },
  'gemini-3.1-pro-preview': { input: 2.0, output: 12.0 },
  'gemini-3-flash-preview': { input: 0.5, output: 3.0 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
};

export function resolveModelPricingUsdPer1M(
  model: string | null | undefined,
): ModelPricingUsdPer1M | null {
  const key = model?.trim() ?? '';
  if (!key) return null;
  const direct = GEMINI_MODEL_PRICING_USD_PER_1M[key];
  if (direct) return direct;
  const lower = key.toLowerCase();
  for (const [name, rates] of Object.entries(GEMINI_MODEL_PRICING_USD_PER_1M)) {
    if (lower.startsWith(name.toLowerCase())) return rates;
  }
  return null;
}

/** Estimated USD for token usage at list price; null when model is unknown. */
export function estimateLlmCostUsd(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const rates = resolveModelPricingUsdPer1M(model);
  if (!rates) return null;
  const inTok = Math.max(0, inputTokens);
  const outTok = Math.max(0, outputTokens);
  return (inTok * rates.input + outTok * rates.output) / 1_000_000;
}

export function getModelRoute(operation: Fr94ModelRouteKey): ResolvedModelRoute {
  const defaults = DEFAULT_ROUTES[operation];
  if (!defaults) {
    throw new Error(
      `Unknown model route: ${String(operation)}. Valid operations: ${FR94_MODEL_ROUTE_KEYS.join(', ')}`,
    );
  }

  const override = envModelOverride(operation);
  const modelOverriddenFromEnv = override != null;

  return {
    operation,
    model: override ?? defaults.model,
    temperature: defaults.temperature,
    maxOutputTokens: defaults.maxOutputTokens,
    useCache: defaults.useCache,
    requireJson: defaults.requireJson,
    thinkingLevel: defaults.thinkingLevel,
    modelOverriddenFromEnv,
  };
}
