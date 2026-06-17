'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  dispatchPipelineRun,
  fetchPipelineStatus,
  isPipelineRunBusy,
} from '@/lib/pipeline-run-client';
import { readJsonResponse } from '@/lib/read-json-response';

type IngestInboxItem = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  size: string | null;
  modifiedTime: string | null;
};

type IngestInboxPayload = {
  count: number;
  total_size_bytes: number;
  items: IngestInboxItem[];
  error?: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function buildInboxTitle(count: number, items: IngestInboxItem[], totalBytes: number): string {
  if (count === 0) return 'No files waiting in Drive ingest folder';
  const names = items
    .slice(0, 8)
    .map((f) => f.name)
    .join('\n');
  const more = count > 8 ? `\n…and ${count - 8} more` : '';
  const sizeLine = totalBytes > 0 ? `\nTotal: ${formatBytes(totalBytes)}` : '';
  return `${count} file${count === 1 ? '' : 's'} waiting in Drive ingest:\n${names}${more}${sizeLine}`;
}

export function IngestQueueControl() {
  const [count, setCount] = useState<number | null>(null);
  const [items, setItems] = useState<IngestInboxItem[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInbox = useCallback(async () => {
    try {
      const res = await fetch('/api/content-review/ingest-inbox', {
        credentials: 'include',
        cache: 'no-store',
      });
      const json = await readJsonResponse<IngestInboxPayload>(res);
      if (!res.ok) {
        setError(json.error || res.statusText);
        setCount(null);
        return;
      }
      setError(null);
      setCount(json.count);
      setItems(json.items ?? []);
      setTotalBytes(json.total_size_bytes ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCount(null);
    }
  }, []);

  const loadPipeline = useCallback(async () => {
    try {
      const json = await fetchPipelineStatus();
      setPipelineStatus(json.last_run_status);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadInbox();
    void loadPipeline();
  }, [loadInbox, loadPipeline]);

  const runBusy = isPipelineRunBusy(pipelineStatus) || dispatching;

  useEffect(() => {
    if (!runBusy) return;
    const id = window.setInterval(() => {
      void loadInbox();
      void loadPipeline();
    }, 5000);
    return () => window.clearInterval(id);
  }, [runBusy, loadInbox, loadPipeline]);

  async function runIngest() {
    setDispatching(true);
    setError(null);
    try {
      const json = await dispatchPipelineRun('assets_only');
      setPipelineStatus(json.last_run_status);
      void loadInbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDispatching(false);
    }
  }

  const waiting = count != null && count > 0;
  const title = count != null ? buildInboxTitle(count, items, totalBytes) : 'Loading ingest folder…';

  return (
    <div className="flex shrink-0 items-center gap-1.5" title={error ?? title}>
      <span
        className={`hidden text-xs tabular-nums sm:inline ${
          waiting ? 'font-medium text-[var(--warn)]' : 'text-[var(--muted)]'
        }`}
      >
        Ingest: {count ?? '…'}
      </span>
      <button
        type="button"
        disabled={runBusy}
        onClick={() => void runIngest()}
        className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
        title={
          runBusy
            ? `Pipeline ${pipelineStatus ?? 'running'}…`
            : 'Run ingest: Drive → analyze → geocode → process'
        }
      >
        {dispatching ? 'Dispatching…' : runBusy ? 'Ingest running…' : 'Run ingest'}
      </button>
    </div>
  );
}
