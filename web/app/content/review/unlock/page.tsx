'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function UnlockForm() {
  const sp = useSearchParams();
  const next = sp.get('next') || '/content/review';
  const [secret, setSecret] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/content-review/unlock', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((json as { error?: string }).error || res.statusText);
      }
      setMsg('OK — redirecting…');
      window.location.href = next;
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16">
      <h1 className="text-xl font-semibold text-[var(--text)]">Review dashboard access</h1>
      <p className="text-sm text-[var(--muted)]">
        If <code className="text-[var(--accent)]">REVIEW_DASHBOARD_SECRET</code> is set on the server,
        enter it here once to set a session cookie. Otherwise this form is a no-op.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="password"
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]"
          placeholder="Dashboard secret"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Continue
        </button>
      </form>
      {msg && <p className="text-sm text-[var(--good)]">{msg}</p>}
      {err && <p className="text-sm text-[var(--bad)]">{err}</p>}
      <a href="/content/review" className="text-sm text-[var(--muted)] underline">
        Back to review
      </a>
    </div>
  );
}

export default function UnlockPage() {
  return (
    <Suspense fallback={<p className="p-8 text-[var(--muted)]">Loading…</p>}>
      <UnlockForm />
    </Suspense>
  );
}
