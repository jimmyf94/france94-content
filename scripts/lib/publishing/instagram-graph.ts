/**
 * Instagram Graph API — containers + optional `media_publish` / media read.
 * Carousel children use IMAGE or VIDEO + is_carousel_item=true (Reels cannot be carousel items).
 * @see https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/
 */

export function graphApiVersion(): string {
  return process.env.INSTAGRAM_GRAPH_API_VERSION?.trim() || 'v21.0';
}

/**
 * Strip BOM, wrapping quotes, zero-width chars, and line breaks — common when copying from the Meta UI, Slack, or PDFs.
 * Meta returns "Cannot parse access token" if the string includes junk, NBSP, or line breaks.
 */
export function normalizeMetaAccessToken(raw: string): string {
  let t = raw.trim();
  if (t.charCodeAt(0) === 0xfeff) {
    t = t.slice(1).trim();
  }
  // Zero-width / invisible characters (copy-paste traps)
  t = t.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '');
  // NBSP, thin/narrow no-break space → remove (not allowed inside Graph tokens)
  t = t.replace(/[\u00A0\u2007\u2009\u202F]/g, '');
  // Markdown / brackets accidentally included
  t = t.replace(/^[`'"[\]()«»]+/, '').replace(/[`'"[\]()«»]+$/, '').trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  t = t.replace(/[\r\n\u2028\u2029\t]+/g, '').trim();
  // Trailing commas / semicolons from CSV or bullet lists
  t = t.replace(/[,;]+$/g, '').trim();
  // Graph user/page tokens are a single segment — remove accidental interior ASCII whitespace
  t = t.replace(/\s+/g, '');
  return t;
}

function normalizeIgUserId(raw: string): string {
  return normalizeMetaAccessToken(raw).replace(/\s+/g, '');
}

export function requireInstagramEnv(): { accessToken: string; igUserId: string } {
  const rawTok = process.env.INSTAGRAM_GRAPH_ACCESS_TOKEN ?? '';
  const rawId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? '';
  const accessToken = normalizeMetaAccessToken(rawTok);
  const igUserId = normalizeIgUserId(rawId);
  if (!accessToken || !igUserId) {
    throw new Error(
      'Missing INSTAGRAM_GRAPH_ACCESS_TOKEN or INSTAGRAM_BUSINESS_ACCOUNT_ID',
    );
  }
  if (accessToken.startsWith('{') || accessToken.includes('"access_token"')) {
    throw new Error(
      'INSTAGRAM_GRAPH_ACCESS_TOKEN looks like JSON, not a plain token string. Paste only the token value (often starts with EAA…).',
    );
  }
  // App access tokens look like "{app_id}|{app_secret}" — wrong credential for IG user calls
  if (accessToken.includes('|') && /^\d+\|/.test(accessToken)) {
    throw new Error(
      'INSTAGRAM_GRAPH_ACCESS_TOKEN looks like an app access token (digits|secret). ' +
        'Publishing needs a User or Page access token from Graph API Explorer / System User / Page token exchange (typically starts with EAA…). ' +
        'Run: npm run check:instagram-token',
    );
  }
  const nonAscii = accessToken.replace(/[\x20-\x7E]/g, '');
  if (nonAscii.length > 0) {
    throw new Error(
      'INSTAGRAM_GRAPH_ACCESS_TOKEN contains non-printable/non-ASCII characters after cleanup — re-copy the token or run npm run check:instagram-token.',
    );
  }
  return { accessToken, igUserId };
}

async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Graph API non-JSON response (${res.status}): ${text.slice(0, 400)}`);
  }
  if (!res.ok) {
    const err = json.error as
      | { message?: string; code?: number; error_subcode?: number; error_user_msg?: string }
      | undefined;
    let msg = err?.message ?? JSON.stringify(json);
    if (err?.code != null || err?.error_subcode != null) {
      msg += ` (Graph code=${err.code ?? 'n/a'}, subcode=${err.error_subcode ?? 'n/a'})`;
    }
    if (err?.error_user_msg && !msg.includes(err.error_user_msg)) {
      msg += ` — ${err.error_user_msg}`;
    }
    const sub = err?.error_subcode;
    if (err?.code === 190) {
      msg +=
        ' Hint: access token expired or revoked. Replace INSTAGRAM_GRAPH_ACCESS_TOKEN (Graph API Explorer or your OAuth flow). Short-lived tokens last ~hours; exchange for a long-lived user token (~60d) with fb_exchange_token, or use a Business System User token for automation. npm run check:instagram-token';
    }
    if (
      sub === 2207052 ||
      /only photo or video can be accepted as media type/i.test(msg)
    ) {
      msg +=
        ' Hint: Instagram Content Publishing accepts JPEG for images only; the URL must return a public image (not HTML/403). If you used PNG/WebP, re-run prepare:publishing after upgrading.';
    }
    throw new Error(msg);
  }
  return json;
}

export async function igFormPost(
  relativePath: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const v = graphApiVersion();
  const { accessToken } = requireInstagramEnv();
  const url = `https://graph.facebook.com/${v}/${relativePath}`;
  const body = new URLSearchParams({ ...fields, access_token: accessToken });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return parseJsonResponse(res);
}

export async function igGet(relativePath: string): Promise<Record<string, unknown>> {
  const v = graphApiVersion();
  const { accessToken } = requireInstagramEnv();
  const url = `https://graph.facebook.com/${v}/${relativePath}`;
  const sep = relativePath.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${sep}access_token=${encodeURIComponent(accessToken)}`);
  return parseJsonResponse(res);
}

export function extractCreationId(res: Record<string, unknown>): string {
  const id = res.id;
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error(`Graph API missing creation id: ${JSON.stringify(res)}`);
  }
  return id.trim();
}

/** Single feed image post container. */
export async function createFeedImageContainer(params: {
  igUserId: string;
  imageUrl: string;
  caption: string;
}): Promise<string> {
  const res = await igFormPost(`${params.igUserId}/media`, {
    image_url: params.imageUrl,
    caption: params.caption,
  });
  return extractCreationId(res);
}

/** Single feed video post (not Reels). */
export async function createFeedVideoContainer(params: {
  igUserId: string;
  videoUrl: string;
  caption: string;
}): Promise<string> {
  const res = await igFormPost(`${params.igUserId}/media`, {
    media_type: 'VIDEO',
    video_url: params.videoUrl,
    caption: params.caption,
  });
  return extractCreationId(res);
}

/** Reels container. */
export async function createReelsContainer(params: {
  igUserId: string;
  videoUrl: string;
  caption: string;
}): Promise<string> {
  const res = await igFormPost(`${params.igUserId}/media`, {
    media_type: 'REELS',
    video_url: params.videoUrl,
    caption: params.caption,
  });
  return extractCreationId(res);
}

/** Story image. */
export async function createStoryImageContainer(params: {
  igUserId: string;
  imageUrl: string;
}): Promise<string> {
  const res = await igFormPost(`${params.igUserId}/media`, {
    media_type: 'STORIES',
    image_url: params.imageUrl,
  });
  return extractCreationId(res);
}

/** Story video. */
export async function createStoryVideoContainer(params: {
  igUserId: string;
  videoUrl: string;
}): Promise<string> {
  const res = await igFormPost(`${params.igUserId}/media`, {
    media_type: 'STORIES',
    video_url: params.videoUrl,
  });
  return extractCreationId(res);
}

/** Carousel image child. */
export async function createCarouselImageChild(params: {
  igUserId: string;
  imageUrl: string;
}): Promise<string> {
  const res = await igFormPost(`${params.igUserId}/media`, {
    image_url: params.imageUrl,
    is_carousel_item: 'true',
  });
  return extractCreationId(res);
}

/** Carousel video child (VIDEO, not REELS). */
export async function createCarouselVideoChild(params: {
  igUserId: string;
  videoUrl: string;
}): Promise<string> {
  const res = await igFormPost(`${params.igUserId}/media`, {
    media_type: 'VIDEO',
    video_url: params.videoUrl,
    is_carousel_item: 'true',
  });
  return extractCreationId(res);
}

/** Parent carousel container; children is comma-separated creation IDs. */
export async function createCarouselParentContainer(params: {
  igUserId: string;
  childCreationIds: string[];
  caption: string;
}): Promise<string> {
  const res = await igFormPost(`${params.igUserId}/media`, {
    media_type: 'CAROUSEL',
    children: params.childCreationIds.join(','),
    caption: params.caption,
  });
  return extractCreationId(res);
}

export type ContainerPoll = {
  id: string;
  status_code: string | null;
  status: string | null;
  raw: Record<string, unknown>;
};

export async function getInstagramContainerStatus(containerId: string): Promise<ContainerPoll> {
  const raw = await igGet(`${containerId}?fields=status_code,status`);
  return {
    id: containerId,
    status_code: typeof raw.status_code === 'string' ? raw.status_code : null,
    status: typeof raw.status === 'string' ? raw.status : null,
    raw,
  };
}

export function isTerminalStatusCode(code: string | null): boolean {
  if (!code) return false;
  const u = code.toUpperCase();
  return u === 'FINISHED' || u === 'ERROR' || u === 'EXPIRED' || u === 'PUBLISHED';
}

export function isFinished(code: string | null): boolean {
  return (code ?? '').toUpperCase() === 'FINISHED';
}

/** Publish a finished container (creation id). Returns published Instagram media id. */
export async function mediaPublish(igUserId: string, creationId: string): Promise<string> {
  const res = await igFormPost(`${igUserId}/media_publish`, {
    creation_id: creationId,
  });
  return extractCreationId(res);
}

/** Best-effort permalink for a published media id. */
export async function getMediaPermalink(mediaId: string): Promise<string | null> {
  const r = await igGet(`${mediaId}?fields=permalink`);
  return typeof r.permalink === 'string' && r.permalink.trim() ? r.permalink.trim() : null;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Search hashtag id via ig_hashtag_search (requires instagram_basic permission). */
export async function igHashtagSearch(igUserId: string, hashtag: string): Promise<string | null> {
  const tag = hashtag.replace(/^#/, '').trim();
  if (!tag) return null;
  const raw = await igGet(
    `ig_hashtag_search?user_id=${encodeURIComponent(igUserId)}&q=${encodeURIComponent(tag)}`,
  );
  const data = raw.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0] as { id?: string } | undefined;
  return typeof first?.id === 'string' ? first.id : null;
}

/** Top media for a hashtag id. */
export async function getHashtagTopMedia(
  hashtagId: string,
  limit = 10,
): Promise<Record<string, unknown>[]> {
  const raw = await igGet(
    `${hashtagId}/top_media?user_id=${encodeURIComponent(requireInstagramEnv().igUserId)}&fields=id,caption,media_type,permalink,timestamp,like_count,comments_count&limit=${limit}`,
  );
  const data = raw.data;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/** Recent media for a hashtag id. */
export async function getHashtagRecentMedia(
  hashtagId: string,
  limit = 10,
): Promise<Record<string, unknown>[]> {
  const raw = await igGet(
    `${hashtagId}/recent_media?user_id=${encodeURIComponent(requireInstagramEnv().igUserId)}&fields=id,caption,media_type,permalink,timestamp,like_count,comments_count&limit=${limit}`,
  );
  const data = raw.data;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/**
 * Business discovery for a public username (requires instagram_basic + pages_read_engagement).
 * Returns null on permission errors — caller should degrade gracefully.
 */
export async function getBusinessDiscovery(
  igUserId: string,
  username: string,
  fields = 'id,username,name,biography,media_count,followers_count,media{caption,media_type,permalink,timestamp,like_count,comments_count}',
): Promise<Record<string, unknown> | null> {
  const handle = username.replace(/^@/, '').trim();
  if (!handle) return null;
  try {
    const raw = await igGet(
      `${igUserId}?fields=business_discovery.username(${encodeURIComponent(handle)}){${fields}}`,
    );
    const bd = raw.business_discovery;
    return bd && typeof bd === 'object' ? (bd as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type InstagramMediaItem = {
  id: string;
  caption: string | null;
  media_type: string | null;
  media_product_type: string | null;
  permalink: string | null;
  timestamp: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  like_count: number | null;
  comments_count: number | null;
};

export type InstagramMediaInsights = {
  views: number | null;
  shares: number | null;
  avgWatchTimeMs: number | null;
  permissionDenied?: boolean;
};

function isInsightsPermissionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /\(Graph code=10\b|#10\)|does not have permission/i.test(err.message);
}

function isReelsMedia(mediaProductType: string | null, mediaType?: string | null): boolean {
  if ((mediaProductType ?? '').toUpperCase() === 'REELS') return true;
  return (mediaType ?? '').toUpperCase() === 'REELS';
}

async function fetchSingleInsightMetric(mediaId: string, metric: string): Promise<number | null> {
  const raw = await igGet(`${mediaId}/insights?metric=${metric}&period=lifetime`);
  const data = raw.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { values?: { value?: unknown }[] };
  return parseOptionalNumber(row.values?.[0]?.value);
}

/** Quick probe: returns false when token lacks instagram_manage_insights. */
export async function probeInsightsPermission(mediaId: string): Promise<boolean> {
  try {
    await igGet(`${mediaId}/insights?metric=views&period=lifetime`);
    return true;
  } catch (err) {
    if (isInsightsPermissionError(err)) return false;
    throw err;
  }
}

/**
 * Fetch media insights (views, shares, avg watch time for reels).
 * Returns null metric values on per-metric errors; sets permissionDenied when scope is missing.
 */
export async function getMediaInsights(
  mediaId: string,
  mediaProductType: string | null,
  mediaType?: string | null,
): Promise<InstagramMediaInsights> {
  const empty: InstagramMediaInsights = { views: null, shares: null, avgWatchTimeMs: null };
  const isReels = isReelsMedia(mediaProductType, mediaType);
  const metrics = isReels
    ? (['views', 'shares', 'ig_reels_avg_watch_time'] as const)
    : (['views', 'shares'] as const);

  const out = { ...empty };
  let permissionDenied = false;

  for (const metric of metrics) {
    try {
      const n = await fetchSingleInsightMetric(mediaId, metric);
      if (metric === 'views') out.views = n;
      else if (metric === 'shares') out.shares = n;
      else if (metric === 'ig_reels_avg_watch_time') out.avgWatchTimeMs = n;
    } catch (err) {
      if (isInsightsPermissionError(err)) {
        permissionDenied = true;
        break;
      }
    }
  }

  if (permissionDenied) out.permissionDenied = true;
  return out;
}

function parseOptionalNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseMediaItem(raw: Record<string, unknown>): InstagramMediaItem {
  return {
    id: typeof raw.id === 'string' ? raw.id : String(raw.id ?? ''),
    caption: typeof raw.caption === 'string' ? raw.caption : null,
    media_type: typeof raw.media_type === 'string' ? raw.media_type : null,
    media_product_type:
      typeof raw.media_product_type === 'string' ? raw.media_product_type : null,
    permalink: typeof raw.permalink === 'string' ? raw.permalink : null,
    timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : null,
    thumbnail_url: typeof raw.thumbnail_url === 'string' ? raw.thumbnail_url : null,
    media_url: typeof raw.media_url === 'string' ? raw.media_url : null,
    like_count: parseOptionalNumber(raw.like_count),
    comments_count: parseOptionalNumber(raw.comments_count),
  };
}

/** List recent media for the connected IG business account. */
export async function getUserMedia(opts?: { limit?: number }): Promise<InstagramMediaItem[]> {
  const { igUserId } = requireInstagramEnv();
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 25));
  const fields =
    'id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count';
  const raw = await igGet(`${igUserId}/media?fields=${fields}&limit=${limit}`);
  const data = raw.data;
  if (!Array.isArray(data)) return [];
  return data.map((item) => parseMediaItem(item as Record<string, unknown>));
}

export async function pollContainerUntilTerminal(
  containerId: string,
  opts?: { maxAttempts?: number; initialDelayMs?: number },
): Promise<ContainerPoll> {
  const maxAttempts = opts?.maxAttempts ?? 36;
  let delay = opts?.initialDelayMs ?? 1500;
  for (let i = 0; i < maxAttempts; i++) {
    const poll = await getInstagramContainerStatus(containerId);
    if (poll.status_code && isTerminalStatusCode(poll.status_code)) {
      return poll;
    }
    await sleep(delay);
    delay = Math.min(delay + 500, 8000);
  }
  return getInstagramContainerStatus(containerId);
}
