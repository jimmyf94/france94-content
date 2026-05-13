'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { readJsonResponse } from '@/lib/read-json-response';

import { CandidateDecisionPanel } from './CandidateDecisionPanel';
import { CandidateOverviewHeader } from './CandidateOverviewHeader';
import { CandidateQueueSidebar } from './CandidateQueueSidebar';
import { FilterDrawer, type ReviewFilters } from './FilterDrawer';
import { MediaPreviewStage } from './MediaPreviewStage';
import { MobileReviewStack } from './mobile/MobileReviewStack';
import { invalidateCandidateMediaCache } from './useCandidateMedia';
import { ProductionJobCard } from './ProductionJobCard';
import { PublishingPrepCard } from './PublishingPrepCard';
import { ReviewHeader } from './ReviewHeader';
import { ShortcutsBanner } from './ShortcutsBanner';
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
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const ALL_STATUSES = 'needs_review,needs_rewrite,approved,ready_to_publish,rejected';

const VALID_TABS: ReadonlySet<StatusTab> = new Set([
  'needs_review',
  'needs_rewrite',
  'approved',
  'ready_to_publish',
  'rejected',
]);

function pickInitialTab(raw: string | null): StatusTab {
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
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>('caption');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<ToastState | null>(null);
  const [mobileSheet, setMobileSheet] = useState<null | 'queue' | 'details' | 'filters'>(null);
  const [mediaReloadNonce, setMediaReloadNonce] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const [queueThumbnails, setQueueThumbnails] = useState<Record<string, string | null>>({});
  const thumbFetchGen = useRef(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const queryString = useMemo(() => {
    const q = new URLSearchParams();
    q.set('status', ALL_STATUSES);
    q.set('limit', '500');
    if (filters.postType.trim()) q.set('post_type', filters.postType.trim());
    if (filters.date.trim()) q.set('candidate_date', filters.date.trim());
    if (filters.priorityMin.trim()) q.set('priority_min', filters.priorityMin.trim());
    if (filters.priorityMax.trim()) q.set('priority_max', filters.priorityMax.trim());
    if (filters.search.trim()) q.set('q', filters.search.trim());
    return q.toString();
  }, [filters]);

  const [candidates, setCandidates] = useState<CandidateListItem[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<PostCandidate | null>(null);

  const fetchCandidatesInternal = useCallback(
    async (mode: 'initial' | 'silent') => {
      const showLoading = mode === 'initial';
      if (showLoading) {
        setLoading(true);
        setError(null);
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
          return { ...prev, ...row } as PostCandidate;
        });
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
      }
    },
    [queryString],
  );

  const fetchCandidates = useCallback(() => fetchCandidatesInternal('initial'), [fetchCandidatesInternal]);

  const silentReloadCandidates = useCallback(
    () => fetchCandidatesInternal('silent'),
    [fetchCandidatesInternal],
  );

  const healStaleAssetLedger = useCallback(async () => {
    try {
      const res = await fetch('/api/content-review/reconcile-asset-reservations', {
        method: 'POST',
        credentials: 'include',
      });
      const json = await readJsonResponse<{
        repairedCount?: number;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      const n = json.repairedCount ?? 0;
      setToast({
        kind: 'good',
        msg: n === 0 ? 'Asset ledger was already clean' : `Released stale reservations for ${n} candidate(s)`,
      });
      await silentReloadCandidates();
    } catch (e) {
      setToast({
        kind: 'bad',
        msg: e instanceof Error ? e.message : 'Heal ledger failed',
      });
    }
  }, [silentReloadCandidates]);

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

  const visibleByTab = useMemo(() => {
    const m: Record<StatusTab, CandidateListItem[]> = {
      needs_review: [],
      needs_rewrite: [],
      approved: [],
      ready_to_publish: [],
      rejected: [],
    };
    for (const c of candidates) {
      if (VALID_TABS.has(c.status as StatusTab)) {
        m[c.status as StatusTab].push(c);
      }
    }
    return m;
  }, [candidates]);

  const counts = useMemo<Record<StatusTab, number>>(
    () => ({
      needs_review: visibleByTab.needs_review.length,
      needs_rewrite: visibleByTab.needs_rewrite.length,
      approved: visibleByTab.approved.length,
      ready_to_publish: visibleByTab.ready_to_publish.length,
      rejected: visibleByTab.rejected.length,
    }),
    [visibleByTab],
  );

  const visible = visibleByTab[activeStatusTab];

  // Keep selection valid for the current tab.
  useEffect(() => {
    if (visible.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !visible.some((c) => c.id === selectedId)) {
      setSelectedId(visible[0].id);
    }
  }, [visible, selectedId]);

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
      return { ...selectedDetail, ...row };
    }
    return listRowToFallbackPostCandidate(row);
  }, [candidates, selectedId, selectedDetail]);

  const handleCandidateUpdated = useCallback((c: PostCandidate) => {
    setCandidates((prev) => prev.map((x) => (x.id === c.id ? toCandidateListItem(c) : x)));
    setSelectedDetail((prev) => (prev?.id === c.id ? c : prev));
  }, []);

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

  const decide = useCallback(
    async (status: DecisionStatus) => {
      if (!selected) return;
      if (selected.invalidated_at) return;
      if (status === 'approved' && selected.has_asset_conflict === true) return;
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

      try {
        const res = await fetch(`/api/content-review/candidates/${decidedId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, reviewer_notes: notes }),
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
      }
    },
    [selected, draftNotes, visible, silentReloadCandidates],
  );

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
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {
        /* ignore */
      });
    } else {
      v.pause();
    }
  }, []);

  useKeyboardShortcuts({
    enabled: !!selected && selected.status !== 'ready_to_publish' && !selected.invalidated_at,
    canApprove: selected ? selected.has_asset_conflict !== true : true,
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
    }
  }, [selected, draftNotes]);

  const regenerate = useCallback(async () => {
    if (!selected || regenerating) return;
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

  return (
    <div className="flex h-[100dvh] flex-col bg-[var(--bg)] text-[var(--text)]">
      <ReviewHeader
        pendingCount={counts.needs_review}
        filters={filters}
        onChangeFilters={setFilters}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((o) => !o)}
        onRefresh={() => void silentReloadCandidates()}
        onHealAssetLedger={() => void healStaleAssetLedger()}
      />

      {filtersOpen && (
        <div className="hidden lg:block">
          <FilterDrawer filters={filters} onChange={setFilters} />
        </div>
      )}

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

      {/* Desktop cockpit */}
      <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)_minmax(300px,380px)]">
        <div className="flex min-h-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
          <CandidateQueueSidebar
            candidates={candidates}
            counts={counts}
            activeTab={activeStatusTab}
            onChangeTab={setActiveStatusTab}
            selectedId={selectedId}
            onSelect={setSelectedId}
            loading={loading}
            firstThumbnailById={queueThumbnails}
          />
        </div>
        <div className="flex min-h-0 flex-col">
          <CandidateOverviewHeader candidate={selected} mediaReloadNonce={mediaReloadNonce} />
          {selected && (
            <>
              <PublishingPrepCard
                candidate={selected}
                reviewDriveFolderUrl={selected.review_drive_folder_url}
                onRefreshQueue={() => void silentReloadCandidates()}
              />
              {selected.post_type === 'reel' && <ProductionJobCard candidate={selected} />}
            </>
          )}
          <MediaPreviewStage
            candidate={selected}
            videoRef={videoRef}
            mediaReloadNonce={mediaReloadNonce}
            onRemoveReviewAsset={handleRemoveReviewAsset}
          />
        </div>
        <CandidateDecisionPanel
          candidate={selected}
          notes={selected ? (draftNotes[selected.id] ?? '') : ''}
          savedNotes={selected?.reviewer_notes ?? ''}
          onChangeNotes={setNotes}
          onSaveNotes={saveNotes}
          onDecide={decide}
          activeTab={activeDetailTab}
          onChangeTab={setActiveDetailTab}
          onCandidateUpdated={handleCandidateUpdated}
          onRegenerate={regenerate}
          regenerating={regenerating}
        />
      </div>

      {/* Mobile stack */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <MobileReviewStack
          candidates={candidates}
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
          mediaReloadNonce={mediaReloadNonce}
          firstThumbnailById={queueThumbnails}
          onCandidateUpdated={handleCandidateUpdated}
          onRemoveReviewAsset={handleRemoveReviewAsset}
          onRegenerate={regenerate}
          regenerating={regenerating}
        />
      </div>

      <ShortcutsBanner />

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
