'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

const PRIMARY_TABS = [
  { label: 'Strategy', href: '/content/strategy' },
  { label: 'Candidates', href: '/content/review' },
  { label: 'Publishing', href: '/content/publishing' },
  { label: 'Feedback', href: '/content/feedback' },
] as const;

function isTabActive(pathname: string, href: string): boolean {
  if (href === '/content/review') {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function secondaryLinkClass(active: boolean): string {
  return `rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
    active
      ? 'border-[var(--accent)] text-[var(--accent)]'
      : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]'
  }`;
}

function tabLinkClass(active: boolean): string {
  return `shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? 'bg-[var(--surface-2)] text-[var(--text)]'
      : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
  }`;
}

export function ContentNav() {
  const pathname = usePathname() ?? '';
  const [pipelineOn, setPipelineOn] = useState<boolean | null>(null);
  const [pipelineLastRun, setPipelineLastRun] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/content-review/pipeline', { credentials: 'include' });
        const json = await readJsonResponse<{
          auto_ingest_enabled?: boolean;
          last_run_finished_at?: string | null;
        }>(res);
        if (!res.ok || cancelled) return;
        setPipelineOn(Boolean(json.auto_ingest_enabled));
        setPipelineLastRun(json.last_run_finished_at ?? null);
      } catch {
        if (!cancelled) {
          setPipelineOn(null);
          setPipelineLastRun(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pipelinePill = useMemo(() => {
    if (pipelineOn === null) return null;
    if (!pipelineOn) {
      return (
        <Link
          href="/content/review/settings"
          className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[11px] text-[var(--muted)] hover:border-[var(--accent)]"
          title="Auto-ingest is off"
        >
          Auto-ingest off
        </Link>
      );
    }
    const rel =
      pipelineLastRun != null
        ? (() => {
            const t = new Date(pipelineLastRun).getTime();
            if (Number.isNaN(t)) return '';
            const mins = Math.round((Date.now() - t) / 60_000);
            if (mins < 1) return 'just now';
            if (mins < 60) return `${mins}m ago`;
            return `${Math.round(mins / 60)}h ago`;
          })()
        : '';
    return (
      <Link
        href="/content/review/settings"
        className="rounded-full border border-[var(--good)] px-2.5 py-0.5 text-[11px] text-[var(--good)]"
        title="Auto-ingest checks every 5 min; runs at your configured interval"
      >
        Auto-ingest on{rel ? ` · last ${rel}` : ''}
      </Link>
    );
  }, [pipelineOn, pipelineLastRun]);

  const manualActive = pathname.startsWith('/content/review/manual-ledger');
  const assetsActive = pathname.startsWith('/content/assets');
  const settingsActive = pathname.startsWith('/content/review/settings');

  return (
    <header className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 lg:px-6">
        <span className="text-sm font-semibold tracking-tight text-[var(--text)]">FR94</span>
        {pipelinePill}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Link
            href="/content/review/manual-ledger"
            className={secondaryLinkClass(manualActive)}
          >
            Manual posts
          </Link>
          <Link href="/content/assets" className={secondaryLinkClass(assetsActive)}>
            Assets
          </Link>
          <Link href="/content/review/settings" className={secondaryLinkClass(settingsActive)}>
            Settings
          </Link>
          <button
            type="button"
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
            className={secondaryLinkClass(false)}
          >
            Log out
          </button>
        </div>
      </div>
      <nav
        className="scrollbar-thin flex gap-1 overflow-x-auto px-4 pb-2 lg:px-6"
        aria-label="Content pipeline"
      >
        {PRIMARY_TABS.map((tab) => {
          const active = isTabActive(pathname, tab.href);
          return (
            <Link key={tab.href} href={tab.href} className={tabLinkClass(active)}>
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
