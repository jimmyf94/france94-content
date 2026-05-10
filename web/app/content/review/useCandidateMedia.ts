'use client';

import { useEffect, useLayoutEffect, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

import type { ReviewDriveFile } from './types';

const cache = new Map<string, ReviewDriveFile[]>();
const inflight = new Map<string, Promise<ReviewDriveFile[]>>();

export function useCandidateMedia(candidateId: string | null) {
  const [files, setFiles] = useState<ReviewDriveFile[]>(() =>
    candidateId ? (cache.get(candidateId) ?? []) : [],
  );
  const [loading, setLoading] = useState(
    candidateId ? !cache.has(candidateId) : false,
  );
  const [error, setError] = useState<string | null>(null);

  // When candidateId changes, React keeps hook state — clear or hydrate from cache
  // before paint so we never render another candidate's file IDs with this id.
  useLayoutEffect(() => {
    if (!candidateId) {
      setFiles([]);
      setLoading(false);
      setError(null);
      return;
    }

    const cached = cache.get(candidateId);
    if (cached) {
      setFiles(cached);
      setLoading(false);
      setError(null);
    } else {
      setFiles([]);
      setLoading(true);
      setError(null);
    }
  }, [candidateId]);

  useEffect(() => {
    if (!candidateId) {
      return;
    }

    let cancelled = false;

    const cached = cache.get(candidateId);
    if (cached) {
      return;
    }

    let p = inflight.get(candidateId);
    if (!p) {
      p = (async () => {
        const res = await fetch(`/api/content-review/candidates/${candidateId}/files`, {
          credentials: 'include',
        });
        const json = await readJsonResponse<{ files?: ReviewDriveFile[]; error?: string }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        return json.files ?? [];
      })();
      inflight.set(candidateId, p);
    }

    p.then((list) => {
      cache.set(candidateId, list);
      inflight.delete(candidateId);
      if (cancelled) return;
      setFiles(list);
      setLoading(false);
    }).catch((e: unknown) => {
      inflight.delete(candidateId);
      if (cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  return { files, loading, error };
}
