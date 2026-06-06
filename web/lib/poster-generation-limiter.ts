/** Limit concurrent ffmpeg poster jobs to avoid Drive API 429s and CPU spikes. */

const MAX_CONCURRENT = Math.max(
  1,
  Math.min(4, Number.parseInt(process.env.MAX_CONCURRENT_POSTER_JOBS ?? '2', 10) || 2),
);

let active = 0;
const waitQueue: Array<() => void> = [];

function releaseSlot(): void {
  active = Math.max(0, active - 1);
  const next = waitQueue.shift();
  if (next) next();
}

function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waitQueue.push(() => {
      active += 1;
      resolve();
    });
  });
}

export async function withPosterGenerationSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

const inflight = new Map<string, Promise<unknown>>();

/** Collapse duplicate poster requests for the same cache key. */
export function singleFlightPoster<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const p = fn().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

export function isDriveRateLimitError(e: unknown): boolean {
  const err = e as { code?: number; response?: { status?: number } };
  const status = err.response?.status ?? err.code;
  return status === 429 || status === 403;
}

/** Retry Drive-backed work when Google returns 429/403 rate limits. */
export async function withDriveRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; baseMs?: number },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 4;
  const baseMs = opts?.baseMs ?? 800;
  let last: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isDriveRateLimitError(e) || attempt === maxAttempts - 1) throw e;
      const delay = baseMs * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw last;
}
