import type { GoogleGenAI } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';

import { geminiCacheDebug, geminiExplicitCacheMinStableChars } from './prompt-version.js';

function debug(msg: string): void {
  if (geminiCacheDebug()) console.warn(`[gemini_cache] ${msg}`);
}

export async function getOrCreatePromptCache(params: {
  ai: GoogleGenAI;
  supabase: SupabaseClient;
  cacheKey: string;
  model: string;
  stableSystemInstruction: string;
  ttlSeconds: number;
  promptVersion: string;
}): Promise<{ resourceName: string; path: 'hit' | 'create' } | null> {
  const { ai, supabase, cacheKey, model, stableSystemInstruction, ttlSeconds, promptVersion } =
    params;

  if (!stableSystemInstruction.trim()) {
    debug(`skip cache create: empty stable instruction (${cacheKey})`);
    return null;
  }

  const minStableChars = geminiExplicitCacheMinStableChars();
  if (minStableChars > 0 && stableSystemInstruction.length < minStableChars) {
    debug(
      `skip explicit cache: stable text ${stableSystemInstruction.length} chars < ${minStableChars} ` +
        `(Gemini caches.create needs ~1024+ tokens on cached content only; media in generateContent does not count) (${cacheKey})`,
    );
    return null;
  }

  const nowIso = new Date().toISOString();
  const { data: existing } = await supabase
    .from('llm_prompt_caches')
    .select('cache_resource_name, expires_at')
    .eq('cache_key', cacheKey)
    .eq('model', model)
    .maybeSingle();

  const row = existing as { cache_resource_name?: string; expires_at?: string } | null;
  if (row?.cache_resource_name && row.expires_at && row.expires_at > nowIso) {
    try {
      await ai.caches.get({ name: row.cache_resource_name });
      debug(`hit cache_key=${cacheKey} model=${model} name=${row.cache_resource_name}`);
      return { resourceName: row.cache_resource_name, path: 'hit' };
    } catch {
      debug(`stored cache expired or invalid for cache_key=${cacheKey}; recreating`);
      await supabase.from('llm_prompt_caches').delete().eq('cache_key', cacheKey).eq('model', model);
    }
  }

  try {
    console.log(
      `[gemini_cache] creating cache_key=${cacheKey.slice(0, 64)} model=${model} stable_chars=${stableSystemInstruction.length} ttl_s=${ttlSeconds}`,
    );
    const created = await ai.caches.create({
      model,
      config: {
        systemInstruction: stableSystemInstruction,
        ttl: `${ttlSeconds}s`,
        displayName: cacheKey.slice(0, 450),
      },
    });
    const resourceName = created.name;
    if (!resourceName) {
      debug('caches.create returned no name');
      return null;
    }
    const expiresAt =
      created.expireTime ?? new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const { error: upErr } = await supabase.from('llm_prompt_caches').upsert(
      {
        cache_key: cacheKey,
        model,
        provider: 'gemini',
        cache_resource_name: resourceName,
        prompt_version: promptVersion,
        ttl_seconds: ttlSeconds,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
        metadata: { source: 'getOrCreatePromptCache' },
      },
      { onConflict: 'cache_key,model' },
    );
    if (upErr) {
      console.warn(`[gemini_cache] Supabase upsert failed: ${upErr.message}`);
    }
    debug(`created cache_key=${cacheKey} name=${resourceName}`);
    return { resourceName, path: 'create' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('TotalCachedContentStorageTokensPerModelFreeTier')) {
      console.warn(
        `[gemini_cache] explicit context cache not available on this API billing tier (${cacheKey}); ` +
          `continuing without caches.create. Implicit caching still applies where prefixes repeat.`,
      );
    } else {
      console.warn(`[gemini_cache] caches.create failed (${cacheKey}): ${msg}`);
    }
    return null;
  }
}
