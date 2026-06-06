'use client';

import { useEffect, useRef, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

import type { ReviewDriveFile } from './types';

function prefetchVideoPosters(files: ReviewDriveFile[]) {
  if (typeof Image === 'undefined') return;
  for (const f of files) {
    if (!f.posterUrl || !f.mimeType.startsWith('video/')) continue;
    const img = new Image();
    img.src = f.posterUrl;
  }
}

/** Bump when ReviewDriveFile shape or enrichment changes (e.g. posterUrl on all videos). */
const MEDIA_CACHE_VERSION = 2;
const cache = new Map<string, ReviewDriveFile[]>();

function cacheKey(candidateId: string) {
  return `${MEDIA_CACHE_VERSION}:${candidateId}`;
}

/** Drop cached folder listing so the next fetch picks up Drive changes. */
export function invalidateCandidateMediaCache(candidateId: string) {
  cache.delete(cacheKey(candidateId));
}

/**
 * Lists files in the candidate review Drive folder.
 * Uses `fetchGen` so a slow in-flight fetch cannot overwrite results after `invalidateCandidateMediaCache` + reload.
 */
export function useCandidateMedia(candidateId: string | null, reloadNonce = 0) {
  const [files, setFiles] = useState<ReviewDriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchGen = useRef(0);

  useEffect(() => {
    if (!candidateId) {
      fetchGen.current += 1;
      setFiles([]);
      setLoading(false);
      setError(null);
      return;
    }

    const key = cacheKey(candidateId);
    const cached = cache.get(key);
    if (reloadNonce === 0 && cached) {
      setFiles(cached);
      setLoading(false);
      setError(null);
      return;
    }

    const gen = ++fetchGen.current;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/content-review/candidates/${candidateId}/files`, {
          credentials: 'include',
        });
        const json = await readJsonResponse<{ files?: ReviewDriveFile[]; error?: string }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        const list = json.files ?? [];
        if (gen !== fetchGen.current) return;
        cache.set(key, list);
        prefetchVideoPosters(list);
        setFiles(list);
        setLoading(false);
      } catch (e) {
        if (gen !== fetchGen.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
  }, [candidateId, reloadNonce]);

  return { files, loading, error };
}

export type CandidateMediaState = {
  files: ReviewDriveFile[];
  loading: boolean;
  error: string | null;
};

export const EMPTY_CANDIDATE_MEDIA: CandidateMediaState = {
  files: [],
  loading: false,
  error: null,
};
