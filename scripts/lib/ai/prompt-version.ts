import { stablePromptCacheSuffix } from './prompt-fingerprint.js';

const DEFAULT_PROMPT_VERSION = '2026-05-10-v1';

export function getFr94PromptVersion(): string {
  const v = process.env.FR94_PROMPT_VERSION?.trim();
  return v && v.length > 0 ? v : DEFAULT_PROMPT_VERSION;
}

function cacheKeyWithStableFingerprint(prefix: string, version: string, stableInstruction: string): string {
  return `${prefix}_${version}_${stablePromptCacheSuffix(stableInstruction)}`;
}

export function cacheKeyAssetAnalysisImage(version: string, stableInstruction: string): string {
  return cacheKeyWithStableFingerprint('fr94_asset_analysis_image', version, stableInstruction);
}

export function cacheKeyAssetAnalysisVideoSampledFrames(version: string, stableInstruction: string): string {
  return cacheKeyWithStableFingerprint('fr94_asset_analysis_video_sampled_frames', version, stableInstruction);
}

export function cacheKeyAssetAnalysisVideoSampledAudio(version: string, stableInstruction: string): string {
  return cacheKeyWithStableFingerprint('fr94_asset_analysis_video_sampled_audio', version, stableInstruction);
}

export function cacheKeyCandidateGeneration(version: string, stableInstruction: string): string {
  return cacheKeyWithStableFingerprint('fr94_candidate_generation', version, stableInstruction);
}

export function cacheKeyCandidateRegeneration(version: string, stableInstruction: string): string {
  return cacheKeyWithStableFingerprint('fr94_candidate_regeneration', version, stableInstruction);
}

export function explicitCachingEnabled(): boolean {
  return process.env.GEMINI_ENABLE_EXPLICIT_CACHING?.trim() === 'true';
}

export function geminiCacheTtlSeconds(): number {
  const raw = process.env.GEMINI_CACHE_TTL_SECONDS?.trim();
  if (!raw) return 86_400;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 60) return 86_400;
  return n;
}

export function geminiCacheDebug(): boolean {
  return process.env.GEMINI_CACHE_DEBUG?.trim() === 'true';
}

export function llmLoggingDisabled(): boolean {
  return process.env.LLM_LOGGING_DISABLE?.trim() === 'true';
}

/**
 * Gemini `caches.create` rejects cached bodies under ~1024 tokens. Only
 * `systemInstruction` / cached contents count — not per-request image/video parts.
 * Rough char floor (~3.5 chars/token for Latin text) to skip doomed creates.
 */
export function geminiExplicitCacheMinStableChars(): number {
  const raw = process.env.GEMINI_CACHE_MIN_STABLE_CHARS?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 3600;
}
