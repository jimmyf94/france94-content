import type { SupabaseClient } from '@supabase/supabase-js';

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function joinUrl(base: string, objectPath: string): string {
  const b = trimSlash(base);
  const p = objectPath.replace(/^\/+/, '');
  return `${b}/${p}`;
}

function envIntClamped(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(max, Math.max(min, n));
}

function isTransientUploadFailure(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('gateway timeout') ||
    msg.includes('504') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('408') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed') ||
    msg.includes('network error') ||
    msg.includes('socket hang up') ||
    msg.includes('service unavailable')
  );
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export function expectedSupabasePublicUrl(
  supabaseUrl: string,
  bucket: string,
  objectPath: string,
): string {
  const u = trimSlash(supabaseUrl);
  const p = objectPath.replace(/^\/+/, '');
  return `${u}/storage/v1/object/public/${bucket}/${p}`;
}

export type UploadPublicMediaResult = {
  objectPath: string;
  publicUrl: string;
};

/**
 * Upload bytes to Supabase Storage public bucket; returns HTTPS URL Instagram can fetch.
 * Retries on transient 5xx / gateway timeouts (large uploads or busy regions).
 */
export async function uploadPublicMedia(params: {
  supabase: SupabaseClient;
  bucket: string;
  publicBaseUrl: string;
  objectPath: string;
  body: Buffer;
  contentType: string;
}): Promise<UploadPublicMediaResult> {
  const { supabase, bucket, publicBaseUrl, objectPath, body, contentType } = params;

  const maxAttempts = envIntClamped('PUBLIC_MEDIA_UPLOAD_MAX_ATTEMPTS', 5, 1, 20);
  const baseDelayMs = envIntClamped('PUBLIC_MEDIA_UPLOAD_RETRY_BASE_MS', 1500, 200, 60_000);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { error: upErr } = await supabase.storage.from(bucket).upload(objectPath, body, {
        contentType,
        upsert: true,
      });
      if (upErr) {
        lastErr = new Error(upErr.message);
        if (isTransientUploadFailure(upErr) && attempt < maxAttempts) {
          const delay = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 400);
          console.warn(
            `[publish]\tstorage upload attempt ${attempt}/${maxAttempts} failed (${upErr.message}); retry in ${delay}ms\tpath=${objectPath}`,
          );
          await sleepMs(delay);
          continue;
        }
        throw new Error(upErr.message);
      }

      const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
      const fromClient = data.publicUrl;

      const configured = joinUrl(publicBaseUrl, objectPath);
      const clientTrim = trimSlash(fromClient);
      const cfgTrim = trimSlash(configured);
      if (clientTrim !== cfgTrim && !clientTrim.endsWith(`/${objectPath}`)) {
        const loose =
          cfgTrim === clientTrim ||
          clientTrim.replace(/\/+$/, '') === cfgTrim.replace(/\/+$/, '');
        if (!loose) {
          console.warn(
            `[publish]\tPublic URL mismatch (check PUBLIC_MEDIA_BASE_URL).\n` +
              `  storage client: ${fromClient}\n` +
              `  configured:     ${configured}`,
          );
        }
      }

      if (attempt > 1) {
        console.warn(`[publish]\tstorage upload succeeded on attempt ${attempt}\tpath=${objectPath}`);
      }

      return { objectPath, publicUrl: configured };
    } catch (e) {
      lastErr = e;
      if (isTransientUploadFailure(e) && attempt < maxAttempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 400);
        console.warn(
          `[publish]\tstorage upload attempt ${attempt}/${maxAttempts} threw; retry in ${delay}ms\tpath=${objectPath}\t${e instanceof Error ? e.message : String(e)}`,
        );
        await sleepMs(delay);
        continue;
      }
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
