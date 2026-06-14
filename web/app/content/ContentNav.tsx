'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';
import { countActivePublishingJobs } from '@/lib/publishing-publish-feedback';
import { isPipelineRunBusy } from '@/lib/pipeline-run-client';

import { openScheduleDrawer, SCHEDULE_QUEUE_CHANGED_EVENT } from './schedule-events';
import {
  isReviewCockpitPath,
  requestReviewGenerate,
  requestReviewHealLedger,
  requestReviewRefresh,
  requestReviewToggleBlocked,
  REVIEW_TOOLBAR_STATE_EVENT,
  type ReviewToolbarState,
} from './review-toolbar-events';

const PRIMARY_TABS = [
  { label: 'Strategy', href: '/content/strategy' },
  { label: 'Review', href: '/content/review' },
  { label: 'Publishing', href: '/content/publishing' },
  { label: 'Feedback', href: '/content/feedback' },
] as const;

function isTabActive(pathname: string, href: string): boolean {
  if (href === '/content/review') {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function IconCalendar({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

function IconManualPosts({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function IconAssets({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function IconSettings({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconLogOut({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function IconGenerate({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="m19.07 4.93-2.12 2.12" />
      <path d="m6.05 17.95-2.12 2.12" />
      <path d="m17.95 17.95-2.12-2.12" />
      <path d="m4.93 4.93 2.12 2.12" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function IconHealLedger({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function IconBlocked({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </svg>
  );
}

function utilityBtnClass(active: boolean): string {
  return `cockpit-btn-secondary flex min-h-11 min-w-11 items-center justify-center p-2 lg:min-h-0 lg:min-w-0 lg:p-1.5 ${
    active ? 'border-[var(--accent)] text-[var(--accent)]' : ''
  }`;
}

function iconBtnClass(extra = ''): string {
  return `cockpit-btn-secondary flex min-h-11 min-w-11 items-center justify-center p-2 lg:min-h-0 lg:min-w-0 lg:p-1.5 ${extra}`.trim();
}

export function ContentNav() {
  const pathname = usePathname() ?? '';
  const [pipelineOn, setPipelineOn] = useState<boolean | null>(null);
  const [scheduleCount, setScheduleCount] = useState(0);
  const [activePublishingCount, setActivePublishingCount] = useState(0);
  const [reviewToolbar, setReviewToolbar] = useState<ReviewToolbarState>({
    generatingCandidates: false,
    generateDisabled: false,
    includeBlocked: false,
  });

  const showReviewToolbar = isReviewCockpitPath(pathname);
  const generateBusy = reviewToolbar.generatingCandidates || reviewToolbar.generateDisabled;
  const scheduleTitle =
    activePublishingCount > 0
      ? `${activePublishingCount} post${activePublishingCount === 1 ? '' : 's'} publishing`
      : scheduleCount > 0
        ? `${scheduleCount} in queue`
        : 'Schedule';

  useEffect(() => {
    let cancelled = false;
    const loadCount = async () => {
      try {
        const res = await fetch('/api/content-review/publishing-jobs', {
          credentials: 'include',
          cache: 'no-store',
        });
        const json = await readJsonResponse<{ items?: Array<{ id: string; status: string }> }>(res);
        if (!cancelled && res.ok) {
          const items = json.items ?? [];
          setScheduleCount(items.length);
          setActivePublishingCount(
            countActivePublishingJobs(items, {}, null),
          );
        }
      } catch {
        if (!cancelled) setScheduleCount(0);
      }
    };
    void loadCount();
    const onQueueChanged = () => void loadCount();
    window.addEventListener(SCHEDULE_QUEUE_CHANGED_EVENT, onQueueChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(SCHEDULE_QUEUE_CHANGED_EVENT, onQueueChanged);
    };
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/content-review/pipeline', { credentials: 'include' });
        const json = await readJsonResponse<{ auto_ingest_enabled?: boolean }>(res);
        if (!res.ok || cancelled) return;
        setPipelineOn(Boolean(json.auto_ingest_enabled));
      } catch {
        if (!cancelled) setPipelineOn(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<ReviewToolbarState>).detail;
      if (detail) setReviewToolbar(detail);
    };
    window.addEventListener(REVIEW_TOOLBAR_STATE_EVENT, onState);
    return () => window.removeEventListener(REVIEW_TOOLBAR_STATE_EVENT, onState);
  }, []);

  const pipelineDot = useMemo(() => {
    if (pipelineOn === null) return null;
    return (
      <span
        className={`h-1.5 w-1.5 rounded-full ${pipelineOn ? 'bg-[var(--good)]' : 'bg-[var(--muted)]'}`}
        title={pipelineOn ? 'Auto-ingest on' : 'Auto-ingest off'}
      />
    );
  }, [pipelineOn]);

  const manualActive = pathname.startsWith('/content/review/manual-ledger');
  const assetsActive = pathname.startsWith('/content/assets');
  const settingsActive = pathname.startsWith('/content/review/settings');

  return (
    <header className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-col gap-2 px-3 py-2 lg:flex-row lg:items-center lg:gap-4 lg:px-5 lg:py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/content/review" className="flex shrink-0 items-center gap-2">
            {pipelineDot}
            <span className="text-sm font-semibold tracking-tight text-[var(--text)]">
              France94 Studio
            </span>
          </Link>

          <nav
            className="scrollbar-thin flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
            aria-label="Content pipeline"
          >
            {PRIMARY_TABS.map((tab) => {
              const active = isTabActive(pathname, tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`shrink-0 rounded-md px-3 py-2 text-sm transition-colors lg:py-1.5 ${
                    active
                      ? 'bg-[var(--surface-2)] font-medium text-[var(--text)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>

          {!pathname.startsWith('/content/publishing') && (
            <button
              type="button"
              onClick={() => openScheduleDrawer()}
              className="relative flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-black bg-black p-2 text-[var(--bad)] transition-[filter] hover:brightness-125 lg:min-h-0 lg:min-w-0"
              aria-label="Schedule"
              title={scheduleTitle}
            >
              <IconCalendar />
              {activePublishingCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--warn)] px-1 text-[10px] font-semibold text-black">
                  {activePublishingCount > 9 ? '9+' : activePublishingCount}
                </span>
              ) : scheduleCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--bad)] px-1 text-[10px] font-semibold text-black">
                  {scheduleCount > 9 ? '9+' : scheduleCount}
                </span>
              ) : null}
            </button>
          )}
        </div>

        <div className="flex min-w-0 items-center justify-end gap-1 lg:ml-auto">
          {showReviewToolbar && (
            <div className="hidden shrink-0 items-center gap-1 lg:flex">
              <button
                type="button"
                onClick={() => requestReviewRefresh()}
                className={`${iconBtnClass()} ${reviewToolbar.refreshingReview ? 'animate-pulse opacity-70' : ''}`}
                aria-label="Refresh"
                title={reviewToolbar.refreshingReview ? 'Refreshing…' : 'Refresh'}
              >
                <IconRefresh />
              </button>
              <button
                type="button"
                disabled={generateBusy}
                onClick={() => requestReviewGenerate()}
                className={`${iconBtnClass()} cockpit-btn-generate disabled:opacity-50`}
                aria-label="Generate new candidates"
                title={
                  reviewToolbar.generatingCandidates
                    ? 'Generating…'
                    : isPipelineRunBusy(reviewToolbar.pipelineRunStatus)
                      ? 'Candidate generation running…'
                      : 'Generate new candidates'
                }
              >
                <IconGenerate />
              </button>
              <button
                type="button"
                disabled={reviewToolbar.healingLedger}
                onClick={() => requestReviewHealLedger()}
                className={`${iconBtnClass()} ${reviewToolbar.healingLedger ? 'animate-pulse opacity-70' : ''}`}
                aria-label="Heal ledger"
                title={reviewToolbar.healingLedger ? 'Healing ledger…' : 'Heal ledger'}
              >
                <IconHealLedger />
              </button>
              <button
                type="button"
                onClick={() => requestReviewToggleBlocked()}
                className={utilityBtnClass(reviewToolbar.includeBlocked)}
                aria-label={
                  reviewToolbar.includeBlocked ? 'Hide other blocked' : 'Show all blocked'
                }
                title={
                  reviewToolbar.includeBlocked ? 'Hide other blocked' : 'Show all blocked'
                }
              >
                <IconBlocked />
              </button>
            </div>
          )}

          <Link
            href="/content/review/manual-ledger"
            className={utilityBtnClass(manualActive)}
            aria-label="Manual posts"
            title="Manual posts"
          >
            <IconManualPosts />
          </Link>
          <Link
            href="/content/assets"
            className={utilityBtnClass(assetsActive)}
            aria-label="Assets"
            title="Assets"
          >
            <IconAssets />
          </Link>
          <Link
            href="/content/review/settings"
            className={utilityBtnClass(settingsActive)}
            aria-label="Settings"
            title="Settings"
          >
            <IconSettings />
          </Link>
          <button
            type="button"
            className={iconBtnClass()}
            aria-label="Log out"
            title="Log out"
            onClick={async () => {
              try {
                await fetch('/api/auth/signout', {
                  method: 'POST',
                  credentials: 'include',
                });
              } catch {
                /* ignore */
              }
              window.location.href = '/login';
            }}
          >
            <IconLogOut />
          </button>
        </div>
      </div>
    </header>
  );
}
