'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import {
  dispatchPipelineRun,
  fetchPipelineStatus,
  isPipelineRunBusy,
} from '@/lib/pipeline-run-client';
import { readJsonResponse } from '@/lib/read-json-response';
import { countActivePublishingJobs } from '@/lib/publishing-publish-feedback';

import { ActiveCandidateWorkspace } from './ActiveCandidateWorkspace';
import { CandidateDecisionPanel } from './CandidateDecisionPanel';
import { CandidateQueueSidebar } from './CandidateQueueSidebar';
import { CollapsibleColumnFrame, columnGridWidth } from './CollapsibleColumnFrame';
import type { ReviewFilters } from './FilterDrawer';
import { MobileReviewStack } from './mobile/MobileReviewStack';
import { ReviewActivityStrip } from './ReviewActivityStrip';
import { usePublishingScheduleQueue } from '../publishing/usePublishingScheduleQueue';
import {
  notifyScheduleQueueChanged,
  SCHEDULE_DRAWER_REFRESH_EVENT,
  SCHEDULE_SELECT_CANDIDATE_EVENT,
  syncReviewSelectedCandidate,
} from '../schedule-events';
import {
  notifyReviewToolbarState,
  REVIEW_TOOLBAR_GENERATE_REQUEST,
  REVIEW_TOOLBAR_HEAL_LEDGER_REQUEST,
  REVIEW_TOOLBAR_REFRESH_REQUEST,
  REVIEW_TOOLBAR_TOGGLE_BLOCKED_REQUEST,
} from '../review-toolbar-events';
import { Toast, type ToastState } from './Toast';
import type {
  CandidateListItem,
  DecisionStatus,
  DetailTab,
  PostCandidate,
  ReviewDriveFile,
  StatusTab,
} from './types';
import { toCandidateListItem } from './types';
import {
  invalidateCandidateMediaCache,
  useCandidateMedia,
} from './useCandidateMedia';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const ALL_STATUSES =
  'needs_review,needs_rewrite,approved,produced,ready_to_publish,rejected,posted';

const VALID_TABS: ReadonlySet<StatusTab> = new Set([
  'needs_review',
  'needs_rewrite',
  'approved',
  'publishing',
  'published',
  'rejected',
]);

function pickInitialTab(raw: string | null): StatusTab {
  if (raw === 'ready_to_publish') return 'publishing';
  if (raw === 'posted') return 'published';
  if (raw && VALID_TABS.has(raw as StatusTab)) return raw as StatusTab;
  return 'needs_review';
}

function shortTitle(t: string | null): string {
  if (!t) return '';
  return t.length > 40 ? `"${t.slice(0, 40)}…"` : `"${t}"`;
}

function decisionToastMessage(status: DecisionStatus, title: string | null): string {
  const t = shortTitle(title);
  if (status === 'approved') return `Approved ${t}`.trim();
  if (status === 'rejected') return `Rejected ${t}`.trim();
  return `Needs rewrite ${t}`.trim();
}

function listRowToFallbackPostCandidate(row: CandidateListItem): PostCandidate {
  return {
    ...row,
    story_frames: null,
    reel_instructions: null,
    carousel_slides: null,
    static_post_instructions: null,
    llm_raw: undefined,
  };
}

/** Keep JSONB detail fields when merging list row refreshes into loaded detail. */
function mergeSelectedCandidate(row: CandidateListItem, detail: PostCandidate): PostCandidate {
  return {
    ...listRowToFallbackPostCandidate(row),
    ...detail,
    ...row,
    story_frames: detail.story_frames,
    reel_instructions: detail.reel_instructions,
    carousel_slides: detail.carousel_slides,
    static_post_instructions: detail.static_post_instructions,
    llm_raw: detail.llm_raw,
    previous_versions: detail.previous_versions,
    published_meta: row.published_meta,
  } as PostCandidate & { published_meta?: CandidateListItem['published_meta'] };
}

export function ReviewDashboard() {
  const sp = useSearchParams();

  const [filters, setFilters] = useState<ReviewFilters>(() => ({
    postType: sp.get('post_type') ?? '',
    date: sp.get('candidate_date') ?? '',
    priorityMin: sp.get('priority_min') ?? '',
    priorityMax: sp.get('priority_max') ?? '',
    search: sp.get('q') ?? '',
  }));
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [activeStatusTab, setActiveStatusTab] = useState<StatusTab>(() =>
    pickInitialTab(sp.get('status')),
  );
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>('structure');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<ToastState | null>(null);
  const [mobileSheet, setMobileSheet] = useState<null | 'queue' | 'details' | 'filters'>(null);
  const [mediaReloadNonce, setMediaReloadNonce] = useState(0);
  const [publishingQueueNonce, setPublishingQueueNonce] = useState(0);
  const {
    items: publishingItems,
    loading: publishingLoading,
    actingJobId: publishingActingJobId,
    publishActingJobId: publishingPublishActingJobId,
    publishFeedbackByJobId: publishingFeedbackByJobId,
    schedulePublish,
    unschedulePublish,
    publishNow,
    unstagePublish,
  } = usePublishingScheduleQueue(publishingQueueNonce);
  const [regenerating, setRegenerating] = useState(false);
  const [generatingCandidates, setGeneratingCandidates] = useState(false);
  const [pipelineRunStatus, setPipelineRunStatus] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [decidingCandidateId, setDecidingCandidateId] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  const [refreshingReview, setRefreshingReview] = useState(false);
  const [healingLedger, setHealingLedger] = useState(false);
  const [queueThumbnails, setQueueThumbnails] = useState<Record<string, string | null>>({});
  const thumbFetchGen = useRef(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activatePrimaryVideoStream = useRef<(() => void) | null>(null);

  const registerActivatePrimaryVideo = useCallback((fn: () => void) => {
    activatePrimaryVideoStream.current = fn;
  }, []);

  useEffect(() => {
    activatePrimaryVideoStream.current = null;
  }, [selectedId]);

  const {
    files: selectedMediaFiles,
    loading: selectedMediaLoading,
    error: selectedMediaError,
  } = useCandidateMedia(selectedId, mediaReloadNonce);

  const selectedMedia = useMemo(
    () => ({
      files: selectedMediaFiles,
      loading: selectedMediaLoading,
      error: selectedMediaError,
    }),
    [selectedMediaFiles, selectedMediaLoading, selectedMediaError],
  );

  useEffect(() => {
    if (publishingQueueNonce === 0) return;
    notifyScheduleQueueChanged();
  }, [publishingQueueNonce]);

  useEffect(() => {
    syncReviewSelectedCandidate(selectedId);
  }, [selectedId]);

  const [includeBlocked, setIncludeBlocked] = useState(false);
  const [shellColumnsCollapsed, setShellColumnsCollapsed] = useState({
    inbox: false,
    decision: false,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const json = await fetchPipelineStatus();
        if (!cancelled) setPipelineRunStatus(json.last_run_status);
      } catch {
        if (!cancelled) setPipelineRunStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isPipelineRunBusy(pipelineRunStatus)) return undefined;
    const timer = window.setInterval(() => {
      void fetchPipelineStatus()
        .then((json) => setPipelineRunStatus(json.last_run_status))
        .catch(() => {
          /* best-effort */
        });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [pipelineRunStatus]);

  const generateCandidates = useCallback(async () => {
    if (generatingCandidates || isPipelineRunBusy(pipelineRunStatus)) return;
    setGeneratingCandidates(true);
    try {
      const json = await dispatchPipelineRun('candidates_only');
      setPipelineRunStatus(json.last_run_status);
      setToast({ kind: 'good', msg: 'Candidate batch dispatched to GitHub Actions.' });
    } catch (e) {
      setToast({
        kind: 'bad',
        msg: e instanceof Error ? e.message : 'Generate failed',
      });
    } finally {
      setGeneratingCandidates(false);
    }
  }, [generatingCandidates, pipelineRunStatus]);

  const queryString = useMemo(() => {
    const q = new URLSearchParams();
    q.set('status', ALL_STATUSES);
    q.set('limit', '500');
    if (includeBlocked) q.set('include_blocked', 'true');
    if (filters.postType.trim()) q.set('post_type', filters.postType.trim());
    if (filters.date.trim()) q.set('candidate_date', filters.date.trim());
    if (filters.priorityMin.trim()) q.set('priority_min', filters.priorityMin.trim());
    if (filters.priorityMax.trim()) q.set('priority_max', filters.priorityMax.trim());
    if (filters.search.trim()) q.set('q', filters.search.trim());
    return q.toString();
  }, [filters, includeBlocked]);

  const [candidates, setCandidates] = useState<CandidateListItem[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<PostCandidate | null>(null);

  const fetchCandidatesInternal = useCallback(
    async (mode: 'initial' | 'silent') => {
      const showLoading = mode === 'initial';
      if (showLoading) {
        setLoading(true);
        setError(null);
      }
      if (mode === 'silent') {
        setRefreshingReview(true);
      }
      try {
        const res = await fetch(`/api/content-review/candidates?${queryString}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const json = await readJsonResponse<{ candidates?: CandidateListItem[]; error?: string }>(
          res,
        );
        if (!res.ok) throw new Error(json.error || res.statusText);
        const list = json.candidates ?? [];
        setCandidates(list);
        setDraftNotes((prev) => {
          const next = { ...prev };
          for (const c of list) if (next[c.id] === undefined) next[c.id] = c.reviewer_notes ?? '';
          return next;
        });
        setSelectedDetail((prev) => {
          if (!prev) return prev;
          const row = list.find((r) => r.id === prev.id);
          if (!row) return null;
          return mergeSelectedCandidate(row, prev);
        });
        setPublishingQueueNonce((n) => n + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        if (showLoading) {
          setCandidates([]);
          setSelectedDetail(null);
        }
      } finally {
        if (showLoading) {
          setLoading(false);
        }
        if (mode === 'silent') {
          setRefreshingReview(false);
        }
      }
    },
    [queryString],
  );

  const fetchCandidates = useCallback(() => fetchCandidatesInternal('initial'), [fetchCandidatesInternal]);

  const silentReloadCandidates = useCallback(
    () => fetchCandidatesInternal('silent'),
    [fetchCandidatesInternal],
  );

  useEffect(() => {
    const onDrawerRefresh = () => void silentReloadCandidates();
    window.addEventListener(SCHEDULE_DRAWER_REFRESH_EVENT, onDrawerRefresh);
    return () => window.removeEventListener(SCHEDULE_DRAWER_REFRESH_EVENT, onDrawerRefresh);
  }, [silentReloadCandidates]);

  const healStaleAssetLedger = useCallback(async () => {
    setHealingLedger(true);
    try {
      const res = await fetch('/api/content-review/reconcile-asset-reservations', {
        method: 'POST',
        credentials: 'include',
      });
      const json = await readJsonResponse<{
        repairedCount?: number;
        repairedAssetSummaryCount?: number;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      const candidateCount = json.repairedCount ?? 0;
      const assetSummaryCount = json.repairedAssetSummaryCount ?? 0;
      const msg =
        candidateCount === 0 && assetSummaryCount === 0
          ? 'Asset ledger was already clean'
          : `Released stale reservations for ${candidateCount} candidate(s); repaired ${assetSummaryCount} asset summary flag(s)`;
      setToast({
        kind: 'good',
        msg,
      });
      await silentReloadCandidates();
    } catch (e) {
      setToast({
        kind: 'bad',
        msg: e instanceof Error ? e.message : 'Heal ledger failed',
      });
    } finally {
      setHealingLedger(false);
    }
  }, [silentReloadCandidates]);

  useEffect(() => {
    const onRefresh = () => void silentReloadCandidates();
    const onGenerate = () => void generateCandidates();
    const onHeal = () => void healStaleAssetLedger();
    const onToggleBlocked = () => setIncludeBlocked((v) => !v);

    window.addEventListener(REVIEW_TOOLBAR_REFRESH_REQUEST, onRefresh);
    window.addEventListener(REVIEW_TOOLBAR_GENERATE_REQUEST, onGenerate);
    window.addEventListener(REVIEW_TOOLBAR_HEAL_LEDGER_REQUEST, onHeal);
    window.addEventListener(REVIEW_TOOLBAR_TOGGLE_BLOCKED_REQUEST, onToggleBlocked);

    return () => {
      window.removeEventListener(REVIEW_TOOLBAR_REFRESH_REQUEST, onRefresh);
      window.removeEventListener(REVIEW_TOOLBAR_GENERATE_REQUEST, onGenerate);
      window.removeEventListener(REVIEW_TOOLBAR_HEAL_LEDGER_REQUEST, onHeal);
      window.removeEventListener(REVIEW_TOOLBAR_TOGGLE_BLOCKED_REQUEST, onToggleBlocked);
    };
  }, [silentReloadCandidates, generateCandidates, healStaleAssetLedger]);

  useEffect(() => {
    notifyReviewToolbarState({
      generatingCandidates,
      generateDisabled: isPipelineRunBusy(pipelineRunStatus),
      includeBlocked,
      refreshingReview,
      healingLedger,
      pipelineRunStatus,
      activePublishingCount: countActivePublishingJobs(
        publishingItems,
        publishingFeedbackByJobId,
        publishingPublishActingJobId,
      ),
    });
  }, [
    generatingCandidates,
    pipelineRunStatus,
    includeBlocked,
    refreshingReview,
    healingLedger,
    publishingItems,
    publishingFeedbackByJobId,
    publishingPublishActingJobId,
  ]);

  useEffect(() => {
    void fetchCandidates();
  }, [fetchCandidates]);

  useEffect(() => {
    if (candidates.length === 0) {
      setQueueThumbnails({});
      return;
    }
    const gen = ++thumbFetchGen.current;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch('/api/content-review/candidates/files-bulk', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: candidates.map((c) => c.id) }),
        });
        const json = await readJsonResponse<{
          thumbnails?: Record<string, string | null>;
          error?: string;
        }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        if (cancelled || gen !== thumbFetchGen.current) return;
        setQueueThumbnails(json.thumbnails ?? {});
      } catch {
        if (cancelled || gen !== thumbFetchGen.current) return;
        /* keep existing thumbnails on failure */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [candidates, mediaReloadNonce]);

  const pipelineCandidateIds = useMemo(
    () => new Set(publishingItems.map((i) => i.post_candidate_id)),
    [publishingItems],
  );

  const visibleByTab = useMemo(() => {
    const m: Record<StatusTab, CandidateListItem[]> = {
      needs_review: [],
      needs_rewrite: [],
      approved: [],
      publishing: [],
      published: [],
      rejected: [],
    };
    for (const c of candidates) {
      if (pipelineCandidateIds.has(c.id)) continue;
      if (c.status === 'produced') {
        m.approved.push(c);
      } else if (c.status === 'needs_review') {
        m.needs_review.push(c);
      } else if (c.status === 'needs_rewrite') {
        m.needs_rewrite.push(c);
      } else if (c.status === 'approved') {
        m.approved.push(c);
      } else if (c.status === 'posted') {
        m.published.push(c);
      } else if (c.status === 'rejected') {
        m.rejected.push(c);
      }
    }
    m.published.sort((a, b) => {
      const aTs = Date.parse(a.published_meta?.published_at ?? a.updated_at ?? '');
      const bTs = Date.parse(b.published_meta?.published_at ?? b.updated_at ?? '');
      return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
    });
    return m;
  }, [candidates, pipelineCandidateIds]);

  const counts = useMemo<Record<StatusTab, number>>(
    () => ({
      needs_review: visibleByTab.needs_review.length,
      needs_rewrite: visibleByTab.needs_rewrite.length,
      approved: visibleByTab.approved.length,
      publishing: publishingItems.length,
      published: visibleByTab.published.length,
      rejected: visibleByTab.rejected.length,
    }),
    [visibleByTab, publishingItems.length],
  );

  const visible = useMemo((): CandidateListItem[] => {
    if (activeStatusTab === 'publishing') {
      return publishingItems
        .map((item) => candidates.find((c) => c.id === item.post_candidate_id))
        .filter((c): c is CandidateListItem => c != null);
    }
    return visibleByTab[activeStatusTab];
  }, [activeStatusTab, publishingItems, candidates, visibleByTab]);

  // Keep selection valid for the current tab.
  useEffect(() => {
    if (activeStatusTab === 'publishing') {
      if (publishingItems.length === 0) {
        if (selectedId !== null) setSelectedId(null);
        return;
      }
      const ids = publishingItems.map((i) => i.post_candidate_id);
      if (!selectedId || !ids.includes(selectedId)) {
        setSelectedId(ids[0]);
      }
      return;
    }
    if (visible.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !visible.some((c) => c.id === selectedId)) {
      setSelectedId(visible[0].id);
    }
  }, [activeStatusTab, visible, publishingItems, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/content-review/candidates/${selectedId}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const json = await readJsonResponse<{ candidate?: PostCandidate; error?: string }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        if (!cancelled && json.candidate?.id === selectedId) {
          setSelectedDetail(json.candidate);
        }
      } catch {
        if (!cancelled) setSelectedDetail(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = useMemo((): PostCandidate | null => {
    if (!selectedId) return null;
    const row = candidates.find((c) => c.id === selectedId);
    if (!row) return null;
    if (selectedDetail?.id === selectedId) {
      return mergeSelectedCandidate(row, selectedDetail);
    }
    return listRowToFallbackPostCandidate(row);
  }, [candidates, selectedId, selectedDetail]);

  const handleCandidateUpdated = useCallback((c: PostCandidate) => {
    setCandidates((prev) => prev.map((x) => (x.id === c.id ? toCandidateListItem(c) : x)));
    setSelectedDetail((prev) => (prev?.id === c.id ? c : prev));
  }, []);

  const handleVariantCreated = useCallback(
    async (c: PostCandidate) => {
      const row = toCandidateListItem(c);
      setCandidates((prev) => (prev.some((x) => x.id === row.id) ? prev : [row, ...prev]));
      setActiveStatusTab('needs_review');
      setSelectedId(c.id);
      setSelectedDetail(c);
      setToast({ kind: 'good', msg: 'Reel variant created — render queued' });
      await silentReloadCandidates();
    },
    [silentReloadCandidates],
  );

  const handleSpawnCreated = useCallback(
    async (c: PostCandidate) => {
      const row = toCandidateListItem(c);
      setCandidates((prev) => (prev.some((x) => x.id === row.id) ? prev : [row, ...prev]));
      setToast({ kind: 'good', msg: 'Iteration created — open Needs review when ready' });
      await silentReloadCandidates();
    },
    [silentReloadCandidates],
  );

  const handleOpenSpawnInReview = useCallback((c: PostCandidate) => {
    setActiveStatusTab('needs_review');
    setSelectedId(c.id);
    setSelectedDetail(c);
  }, []);

  const handleScheduleSelectCandidate = useCallback((candidateId: string) => {
    setSelectedId(candidateId);
    setActiveStatusTab('publishing');
  }, []);

  useEffect(() => {
    const fromUrl = sp.get('candidate');
    if (fromUrl) handleScheduleSelectCandidate(fromUrl);
  }, [sp, handleScheduleSelectCandidate]);

  useEffect(() => {
    const onSelect = (event: Event) => {
      const id = (event as CustomEvent<{ candidateId: string }>).detail?.candidateId;
      if (id) handleScheduleSelectCandidate(id);
    };
    window.addEventListener(SCHEDULE_SELECT_CANDIDATE_EVENT, onSelect);
    return () => window.removeEventListener(SCHEDULE_SELECT_CANDIDATE_EVENT, onSelect);
  }, [handleScheduleSelectCandidate]);

  const handleRemoveReviewAsset = useCallback(
    (file: ReviewDriveFile) => {
      if (!selected) return;
      const cid = selected.id;
      const msg = `Remove "${file.name}" from this candidate? The copy in the review folder will be deleted from Drive; the asset stays in your library (Supabase content_assets).`;
      if (!window.confirm(msg)) return;
      void (async () => {
        try {
          const res = await fetch(
            `/api/content-review/candidates/${cid}/review-assets/${encodeURIComponent(file.id)}`,
            { method: 'DELETE', credentials: 'include' },
          );
          const json = await readJsonResponse<{ candidate?: PostCandidate; error?: string }>(res);
          if (!res.ok) throw new Error(json.error || res.statusText);
          invalidateCandidateMediaCache(cid);
          setMediaReloadNonce((n) => n + 1);
          if (json.candidate) {
            handleCandidateUpdated(json.candidate);
          }
          setToast({ kind: 'good', msg: 'Removed from candidate (library unchanged)' });
        } catch (e) {
          setToast({
            kind: 'bad',
            msg: e instanceof Error ? e.message : 'Remove failed',
          });
        }
      })();
    },
    [selected, handleCandidateUpdated],
  );

  const handleCarouselAssetsAdded = useCallback(
    (updated: PostCandidate) => {
      invalidateCandidateMediaCache(updated.id);
      setMediaReloadNonce((n) => n + 1);
      handleCandidateUpdated(updated);
      setToast({ kind: 'good', msg: 'Added slide(s) from library' });
    },
    [handleCandidateUpdated],
  );

  const handleReorderCarouselSlides = useCallback(
    (orderedAssetIds: string[]) => {
      if (!selected) return;
      const cid = selected.id;
      void (async () => {
        try {
          const res = await fetch(`/api/content-review/candidates/${cid}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              carousel_slides: orderedAssetIds.map((asset_id, i) => ({
                slide: i + 1,
                asset_id,
              })),
            }),
          });
          const json = await readJsonResponse<{ candidate?: PostCandidate; error?: string }>(res);
          if (!res.ok) throw new Error(json.error || res.statusText);
          invalidateCandidateMediaCache(cid);
          setMediaReloadNonce((n) => n + 1);
          if (json.candidate) {
            handleCandidateUpdated(json.candidate);
          }
          setToast({ kind: 'good', msg: 'Carousel order updated' });
        } catch (e) {
          setToast({
            kind: 'bad',
            msg: e instanceof Error ? e.message : 'Reorder failed',
          });
        }
      })();
    },
    [selected, handleCandidateUpdated],
  );

  const decide = useCallback(
    async (status: DecisionStatus, opts?: { overrideCollision?: boolean }) => {
      if (!selected) return;
      if (selected.invalidated_at) return;
      if (selected.status === 'ready_to_publish' || selected.status === 'posted') return;
      const collisionRisk = (selected.collision_risk ?? '').trim();
      if (
        status === 'approved' &&
        !opts?.overrideCollision &&
        (collisionRisk === 'blocked' || collisionRisk === 'high')
      ) {
        return;
      }
      const decidedId = selected.id;
      const decidedTitle = selected.title;
      const previousStatus = selected.status;
      const previousNotes = selected.reviewer_notes;
      const notes = draftNotes[decidedId] ?? '';

      const oldIndex = visible.findIndex((c) => c.id === decidedId);
      const remaining = visible.filter((c) => c.id !== decidedId);
      const next =
        remaining[oldIndex] ?? remaining[oldIndex - 1] ?? remaining[0] ?? null;

      const now = new Date().toISOString();
      setCandidates((prev) =>
        prev.map((c) =>
          c.id === decidedId
            ? { ...c, status, reviewer_notes: notes, updated_at: now }
            : c,
        ),
      );
      setSelectedDetail((prev) =>
        prev?.id === decidedId
          ? { ...prev, status, reviewer_notes: notes, updated_at: now }
          : prev,
      );
      setSelectedId(next?.id ?? null);
      setToast({ kind: 'good', msg: decisionToastMessage(status, decidedTitle) });

      setDecidingCandidateId(decidedId);
      try {
        const res = await fetch(`/api/content-review/candidates/${decidedId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status,
            reviewer_notes: notes,
            ...(opts?.overrideCollision ? { override_collision: true } : {}),
          }),
        });
        const json = await readJsonResponse<{ candidate?: PostCandidate; error?: string }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        if (json.candidate) {
          const row = toCandidateListItem(json.candidate);
          setCandidates((prev) => prev.map((c) => (c.id === row.id ? row : c)));
          setSelectedDetail((prev) =>
            prev?.id === row.id ? { ...prev, ...json.candidate! } : prev,
          );
        }
        await silentReloadCandidates();
      } catch (e) {
        setCandidates((prev) =>
          prev.map((c) =>
            c.id === decidedId
              ? { ...c, status: previousStatus, reviewer_notes: previousNotes }
              : c,
          ),
        );
        setSelectedDetail((prev) =>
          prev?.id === decidedId
            ? { ...prev, status: previousStatus, reviewer_notes: previousNotes }
            : prev,
        );
        setToast({
          kind: 'bad',
          msg: e instanceof Error ? `Save failed: ${e.message}` : 'Save failed',
        });
      } finally {
        setDecidingCandidateId(null);
      }
    },
    [selected, draftNotes, visible, silentReloadCandidates],
  );

  const deleteCandidate = useCallback(async () => {
    if (!selected) return;
    if (selected.invalidated_at) return;
    if (selected.status === 'ready_to_publish' || selected.status === 'posted') return;
    if (deleting) return;

    const deletedId = selected.id;
    const deletedTitle = selected.title;
    const previousCandidates = candidates;
    const previousSelectedId = selectedId;
    const previousDetail = selectedDetail;

    const oldIndex = visible.findIndex((c) => c.id === deletedId);
    const remaining = visible.filter((c) => c.id !== deletedId);
    const next =
      remaining[oldIndex] ?? remaining[oldIndex - 1] ?? remaining[0] ?? null;

    setCandidates((prev) => prev.filter((c) => c.id !== deletedId));
    setSelectedDetail((prev) => (prev?.id === deletedId ? null : prev));
    setSelectedId(next?.id ?? null);
    setDraftNotes((prev) => {
      const copy = { ...prev };
      delete copy[deletedId];
      return copy;
    });
    invalidateCandidateMediaCache(deletedId);
    setMediaReloadNonce((n) => n + 1);
    setToast({ kind: 'good', msg: `Deleted ${shortTitle(deletedTitle)}`.trim() });

    setDeleting(true);
    try {
      const res = await fetch(`/api/content-review/candidates/${deletedId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      await silentReloadCandidates();
      setPublishingQueueNonce((n) => n + 1);
    } catch (e) {
      setCandidates(previousCandidates);
      setSelectedId(previousSelectedId);
      setSelectedDetail(previousDetail);
      setToast({
        kind: 'bad',
        msg: e instanceof Error ? `Delete failed: ${e.message}` : 'Delete failed',
      });
    } finally {
      setDeleting(false);
    }
  }, [
    selected,
    deleting,
    candidates,
    selectedId,
    selectedDetail,
    visible,
    silentReloadCandidates,
  ]);

  const goNext = useCallback(() => {
    if (visible.length === 0) {
      setSelectedId(null);
      return;
    }
    const i = selectedId ? visible.findIndex((c) => c.id === selectedId) : -1;
    const target = i < 0 ? visible[0] : visible[Math.min(i + 1, visible.length - 1)];
    if (target && target.id !== selectedId) setSelectedId(target.id);
  }, [visible, selectedId]);

  const goPrev = useCallback(() => {
    if (visible.length === 0) {
      setSelectedId(null);
      return;
    }
    const i = selectedId ? visible.findIndex((c) => c.id === selectedId) : -1;
    const target = i <= 0 ? visible[0] : visible[i - 1];
    if (target && target.id !== selectedId) setSelectedId(target.id);
  }, [visible, selectedId]);

  const swipeNext = useCallback(() => {
    if (visible.length === 0) return;
    const i = selectedId ? visible.findIndex((c) => c.id === selectedId) : -1;
    const target = visible[(Math.max(i, 0) + 1) % visible.length];
    if (target && target.id !== selectedId) setSelectedId(target.id);
  }, [visible, selectedId]);

  const swipePrev = useCallback(() => {
    if (visible.length === 0) return;
    const i = selectedId ? visible.findIndex((c) => c.id === selectedId) : -1;
    const base = i < 0 ? 0 : i;
    const target = visible[(base - 1 + visible.length) % visible.length];
    if (target && target.id !== selectedId) setSelectedId(target.id);
  }, [visible, selectedId]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) {
      activatePrimaryVideoStream.current?.();
      requestAnimationFrame(() => {
        const el = videoRef.current;
        if (el?.paused) {
          void el.play().catch(() => {
            /* ignore */
          });
        }
      });
      return;
    }
    if (v.paused) {
      void v.play().catch(() => {
        /* ignore */
      });
    } else {
      v.pause();
    }
  }, []);

  useKeyboardShortcuts({
    enabled:
      !!selected &&
      selected.status !== 'ready_to_publish' &&
      selected.status !== 'posted' &&
      !selected.invalidated_at,
    canApprove: selected
      ? !['blocked', 'high'].includes((selected.collision_risk ?? '').trim())
      : true,
    onApprove: useCallback(() => void decide('approved'), [decide]),
    onRewrite: useCallback(() => void decide('needs_rewrite'), [decide]),
    onReject: useCallback(() => void decide('rejected'), [decide]),
    onNext: goNext,
    onPrev: goPrev,
    onTogglePlay: togglePlay,
  });

  const setNotes = useCallback(
    (value: string) => {
      if (!selected) return;
      setDraftNotes((prev) => ({ ...prev, [selected.id]: value }));
    },
    [selected],
  );

  const saveNotes = useCallback(async () => {
    if (!selected) return;
    const id = selected.id;
    const previousNotes = selected.reviewer_notes;
    const notes = draftNotes[id] ?? '';

    const now = new Date().toISOString();
    setCandidates((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, reviewer_notes: notes, updated_at: now } : c,
      ),
    );
    setSelectedDetail((prev) =>
      prev?.id === id ? { ...prev, reviewer_notes: notes, updated_at: now } : prev,
    );

    setSavingNotes(true);
    try {
      const res = await fetch(`/api/content-review/candidates/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer_notes: notes }),
      });
      const json = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setToast({ kind: 'good', msg: 'Notes saved' });
    } catch (e) {
      setCandidates((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, reviewer_notes: previousNotes } : c,
        ),
      );
      setSelectedDetail((prev) =>
        prev?.id === id ? { ...prev, reviewer_notes: previousNotes } : prev,
      );
      setToast({
        kind: 'bad',
        msg: e instanceof Error ? `Save failed: ${e.message}` : 'Save failed',
      });
    } finally {
      setSavingNotes(false);
    }
  }, [selected, draftNotes]);

  const regenerate = useCallback(async () => {
    if (!selected || regenerating) return;
    if (selected.status === 'posted') return;
    const id = selected.id;
    const draft = draftNotes[id] ?? '';
    const saved = selected.reviewer_notes ?? '';

    // Persist any unsaved notes first so the server reads the latest reviewer_notes from Supabase.
    if (draft !== saved) {
      try {
        const res = await fetch(`/api/content-review/candidates/${id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewer_notes: draft }),
        });
        const json = await readJsonResponse<{ error?: string }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        setCandidates((prev) =>
          prev.map((c) =>
            c.id === id ? { ...c, reviewer_notes: draft } : c,
          ),
        );
        setSelectedDetail((prev) =>
          prev?.id === id ? { ...prev, reviewer_notes: draft } : prev,
        );
      } catch (e) {
        setToast({
          kind: 'bad',
          msg: e instanceof Error ? `Save notes failed: ${e.message}` : 'Save notes failed',
        });
        return;
      }
    }

    setRegenerating(true);
    try {
      const res = await fetch(`/api/content-review/candidates/${id}/regenerate`, {
        method: 'POST',
        credentials: 'include',
      });
      const json = await readJsonResponse<{ candidate?: PostCandidate; error?: string }>(res);
      if (!res.ok || !json.candidate) {
        throw new Error(json.error || res.statusText);
      }
      handleCandidateUpdated(json.candidate);
      setDraftNotes((prev) => ({
        ...prev,
        [id]: json.candidate?.reviewer_notes ?? '',
      }));
      setToast({ kind: 'good', msg: 'Candidate regenerated' });
    } catch (e) {
      setToast({
        kind: 'bad',
        msg: e instanceof Error ? `Regenerate failed: ${e.message}` : 'Regenerate failed',
      });
    } finally {
      setRegenerating(false);
    }
  }, [selected, regenerating, draftNotes, handleCandidateUpdated]);

  const refreshPublishingQueue = useCallback(() => {
    void silentReloadCandidates();
    setPublishingQueueNonce((n) => n + 1);
  }, [silentReloadCandidates]);

  const handlePublishingSchedule = useCallback(
    async (jobId: string, iso: string) => {
      await schedulePublish(jobId, iso);
      refreshPublishingQueue();
    },
    [schedulePublish, refreshPublishingQueue],
  );

  const handlePublishingUnschedule = useCallback(
    async (jobId: string) => {
      await unschedulePublish(jobId);
      refreshPublishingQueue();
    },
    [unschedulePublish, refreshPublishingQueue],
  );

  const handlePublishingPublishNow = useCallback(
    async (jobId: string) => {
      await publishNow(jobId);
      refreshPublishingQueue();
    },
    [publishNow, refreshPublishingQueue],
  );

  const handlePublishingUnstage = useCallback(
    async (jobId: string) => {
      await unstagePublish(jobId);
      refreshPublishingQueue();
    },
    [unstagePublish, refreshPublishingQueue],
  );

  const publishingSidebarProps = {
    publishingItems,
    publishingLoading,
    publishingActingJobId,
    publishingFeedbackByJobId,
    publishingPublishActingJobId,
    onSchedulePublish: handlePublishingSchedule,
    onUnschedulePublish: handlePublishingUnschedule,
    onPublishNow: handlePublishingPublishNow,
    onUnstagePublish: handlePublishingUnstage,
    onRefreshPublishing: refreshPublishingQueue,
  };

  const activityState = {
    publishingItems,
    publishFeedbackByJobId: publishingFeedbackByJobId,
    publishActingJobId: publishingPublishActingJobId,
    pipelineRunStatus,
    generatingCandidates,
    regenerating,
    decidingCandidateId,
    savingNotes,
    refreshingReview,
    healingLedger,
  };

  const inboxListCount =
    activeStatusTab === 'publishing' ? publishingItems.length : counts[activeStatusTab];

  const desktopGridTemplate = [
    columnGridWidth(shellColumnsCollapsed.inbox, 'minmax(260px,320px)'),
    'minmax(0,1fr)',
    columnGridWidth(shellColumnsCollapsed.decision, 'minmax(300px,380px)'),
  ].join(' ');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <div className="shrink-0 border-b border-[var(--bad)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--bad)] lg:px-6">
          {error}
          <button
            type="button"
            onClick={() => void fetchCandidates()}
            className="ml-3 underline"
          >
            Retry
          </button>
        </div>
      )}

      <ReviewActivityStrip state={activityState} />

      {/* Desktop operator cockpit */}
      <div
        className="hidden min-h-0 flex-1 lg:grid"
        style={{ gridTemplateColumns: desktopGridTemplate }}
      >
        <CollapsibleColumnFrame
          label="Inbox"
          badge={inboxListCount}
          collapsed={shellColumnsCollapsed.inbox}
          onToggleCollapsed={() =>
            setShellColumnsCollapsed((prev) => ({ ...prev, inbox: !prev.inbox }))
          }
          hideHeaderWhenExpanded
        >
          <CandidateQueueSidebar
            queueCandidates={visible}
            counts={counts}
            activeTab={activeStatusTab}
            onChangeTab={setActiveStatusTab}
            selectedId={selectedId}
            onSelect={setSelectedId}
            loading={loading}
            firstThumbnailById={queueThumbnails}
            filters={filters}
            onChangeFilters={setFilters}
            filtersOpen={filtersOpen}
            onToggleFilters={() => setFiltersOpen((o) => !o)}
            onCloseFilters={() => setFiltersOpen(false)}
            {...publishingSidebarProps}
          />
        </CollapsibleColumnFrame>
        <ActiveCandidateWorkspace
          candidate={selected}
          media={selectedMedia}
          videoRef={videoRef}
          onRegisterActivateStream={registerActivatePrimaryVideo}
          onRemoveReviewAsset={handleRemoveReviewAsset}
          onCarouselAssetsAdded={handleCarouselAssetsAdded}
          onReorderCarouselSlides={handleReorderCarouselSlides}
          onCandidateUpdated={handleCandidateUpdated}
          onVariantCreated={handleVariantCreated}
          onDecide={decide}
          onApproveAnyway={() => void decide('approved', { overrideCollision: true })}
          decisionsDisabled={
            selected?.status === 'ready_to_publish' || selected?.status === 'posted'
          }
          approveDisabled={
            ['blocked', 'high'].includes((selected?.collision_risk ?? '').trim())
          }
          allDecisionsDisabled={Boolean(selected?.invalidated_at)}
          onDelete={() => void deleteCandidate()}
          deleting={deleting}
          deciding={Boolean(decidingCandidateId)}
          onRefreshQueue={() => {
            void silentReloadCandidates();
            setPublishingQueueNonce((n) => n + 1);
          }}
          onStageError={(message) => setToast({ kind: 'bad', msg: message })}
        />
        <CollapsibleColumnFrame
          label="Details"
          collapsed={shellColumnsCollapsed.decision}
          togglePlacement="start"
          onToggleCollapsed={() =>
            setShellColumnsCollapsed((prev) => ({ ...prev, decision: !prev.decision }))
          }
          borderSide="left"
          hideHeaderWhenExpanded
        >
          <CandidateDecisionPanel
            candidate={selected}
            mediaFiles={selectedMedia.files}
            notes={selected ? (draftNotes[selected.id] ?? '') : ''}
            savedNotes={selected?.reviewer_notes ?? ''}
            onChangeNotes={setNotes}
            onSaveNotes={saveNotes}
            activeTab={activeDetailTab}
            onChangeTab={setActiveDetailTab}
            onCandidateUpdated={handleCandidateUpdated}
            onRegenerate={regenerate}
            regenerating={regenerating}
            savingNotes={savingNotes}
            onSpawnCreated={handleSpawnCreated}
            onGoToSpawnInReview={handleOpenSpawnInReview}
            onRefreshQueue={() => {
              void silentReloadCandidates();
              setPublishingQueueNonce((n) => n + 1);
            }}
          />
        </CollapsibleColumnFrame>
      </div>

      {/* Mobile stack */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <MobileReviewStack
          queueCandidates={visible}
          counts={counts}
          activeStatusTab={activeStatusTab}
          onChangeStatusTab={setActiveStatusTab}
          selected={selected}
          onSelect={setSelectedId}
          notes={selected ? (draftNotes[selected.id] ?? '') : ''}
          savedNotes={selected?.reviewer_notes ?? ''}
          onChangeNotes={setNotes}
          onSaveNotes={saveNotes}
          onDecide={decide}
          onApproveAnyway={() => void decide('approved', { overrideCollision: true })}
          activeDetailTab={activeDetailTab}
          onChangeDetailTab={setActiveDetailTab}
          mobileSheet={mobileSheet}
          onChangeSheet={setMobileSheet}
          filters={filters}
          onChangeFilters={setFilters}
          videoRef={videoRef}
          loading={loading}
          onRefresh={() => void silentReloadCandidates()}
          onRefreshQueue={() => void silentReloadCandidates()}
          onSwipeNext={swipeNext}
          onSwipePrev={swipePrev}
          media={selectedMedia}
          onRegisterActivateStream={registerActivatePrimaryVideo}
          firstThumbnailById={queueThumbnails}
          onCandidateUpdated={handleCandidateUpdated}
          onVariantCreated={handleVariantCreated}
          onSpawnCreated={handleSpawnCreated}
          onGoToSpawnInReview={handleOpenSpawnInReview}
          onRemoveReviewAsset={handleRemoveReviewAsset}
          onRegenerate={regenerate}
          regenerating={regenerating}
          savingNotes={savingNotes}
          onDelete={() => void deleteCandidate()}
          deleting={deleting}
          deciding={Boolean(decidingCandidateId)}
          onGenerateCandidates={generateCandidates}
          generatingCandidates={generatingCandidates}
          generateDisabled={isPipelineRunBusy(pipelineRunStatus)}
          {...publishingSidebarProps}
        />
      </div>

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
