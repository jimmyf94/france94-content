'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { ScheduleDrawer } from './review/ScheduleDrawer';
import {
  notifyScheduleDrawerRefresh,
  notifyScheduleQueueChanged,
  notifyScheduleSelectCandidate,
  OPEN_SCHEDULE_DRAWER_EVENT,
  REVIEW_SELECTED_CANDIDATE_EVENT,
  SCHEDULE_QUEUE_CHANGED_EVENT,
} from './schedule-events';

export function ScheduleDrawerHost() {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_SCHEDULE_DRAWER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SCHEDULE_DRAWER_EVENT, onOpen);
  }, []);

  useEffect(() => {
    const onQueueChanged = () => setReloadNonce((n) => n + 1);
    window.addEventListener(SCHEDULE_QUEUE_CHANGED_EVENT, onQueueChanged);
    return () => window.removeEventListener(SCHEDULE_QUEUE_CHANGED_EVENT, onQueueChanged);
  }, []);

  useEffect(() => {
    const onSelected = (event: Event) => {
      const id = (event as CustomEvent<{ candidateId: string | null }>).detail?.candidateId ?? null;
      setSelectedCandidateId(id);
    };
    window.addEventListener(REVIEW_SELECTED_CANDIDATE_EVENT, onSelected);
    return () => window.removeEventListener(REVIEW_SELECTED_CANDIDATE_EVENT, onSelected);
  }, []);

  useEffect(() => {
    if (!pathname.startsWith('/content/review')) {
      setSelectedCandidateId(null);
    }
  }, [pathname]);

  const handleRefresh = useCallback(() => {
    setReloadNonce((n) => n + 1);
    notifyScheduleQueueChanged();
    notifyScheduleDrawerRefresh();
  }, []);

  const handleSelectCandidate = useCallback(
    (candidateId: string) => {
      if (pathname.startsWith('/content/review')) {
        notifyScheduleSelectCandidate(candidateId);
      } else {
        router.push(`/content/review?candidate=${encodeURIComponent(candidateId)}`);
      }
    },
    [pathname, router],
  );

  return (
    <ScheduleDrawer
      open={open}
      onClose={() => setOpen(false)}
      reloadNonce={reloadNonce}
      onRefresh={handleRefresh}
      onSelectCandidate={handleSelectCandidate}
      selectedCandidateId={selectedCandidateId}
    />
  );
}
