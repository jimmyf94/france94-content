'use client';

import { useCallback, useEffect, useState } from 'react';

import type { FeedbackPostRow, FeedbackResponse } from '@/lib/feedback-types';
import { readJsonResponse } from '@/lib/read-json-response';

export function useFeedbackPosts(limit = 50) {
  const [posts, setPosts] = useState<FeedbackPostRow[]>([]);
  const [insightsAvailable, setInsightsAvailable] = useState<boolean | null>(null);
  const [insightsPermissionDenied, setInsightsPermissionDenied] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/content-review/feedback?limit=${limit}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const json = await readJsonResponse<FeedbackResponse>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setPosts(json.posts ?? []);
      setInsightsAvailable(json.insightsAvailable ?? false);
      setInsightsPermissionDenied(json.insightsPermissionDenied ?? false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPosts([]);
      setInsightsAvailable(null);
      setInsightsPermissionDenied(null);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    posts,
    insightsAvailable,
    insightsPermissionDenied,
    loading,
    error,
    load,
  };
}
