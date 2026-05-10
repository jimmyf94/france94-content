'use client';

import { useEffect, useRef, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

import type { ReviewDriveFile } from './types';

const cache = new Map<string, ReviewDriveFile[]>();

/** Drop cached folder listing so the next fetch picks up Drive changes. */
export function invalidateCandidateMediaCache(candidateId: string) {
  cache.delete(candidateId);
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

    const cached = cache.get(candidateId);
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
        cache.set(candidateId, list);
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
