const DEFAULT_PROMPT_VERSION = '2026-05-10-v1';

export function getFr94PromptVersion(): string {
  const v = process.env.FR94_PROMPT_VERSION?.trim();
  return v && v.length > 0 ? v : DEFAULT_PROMPT_VERSION;
}

export function cacheKeyAssetAnalysisImage(version = getFr94PromptVersion()): string {
  return `fr94_asset_analysis_image_${version}`;
}

export function cacheKeyAssetAnalysisVideoSampledFrames(version = getFr94PromptVersion()): string {
  return `fr94_asset_analysis_video_sampled_frames_${version}`;
}

export function cacheKeyAssetAnalysisVideoSampledAudio(version = getFr94PromptVersion()): string {
  return `fr94_asset_analysis_video_sampled_audio_${version}`;
}

export function cacheKeyCandidateGeneration(version = getFr94PromptVersion()): string {
  return `fr94_candidate_generation_${version}`;
}

export function cacheKeyCandidateRegeneration(version = getFr94PromptVersion()): string {
  return `fr94_candidate_regeneration_${version}`;
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
