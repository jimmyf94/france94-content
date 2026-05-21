'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

function LoginForm() {
  const sp = useSearchParams();
  const next = sp.get('next') || '/content/review';
  const error = sp.get('error');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const errorMessage =
    error === 'not_allowed'
      ? 'This Google account is not authorized for FR94.'
      : error === 'auth_failed'
        ? 'Sign-in failed. Please try again.'
        : null;

  async function signInWithGoogle() {
    setLoading(true);
    setErr(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (oauthError) throw oauthError;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text)]">FR94 Content</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Sign in with your authorized Google account to access the review dashboard.
        </p>
      </div>

      {(errorMessage || err) && (
        <p className="rounded border border-[var(--bad)]/40 bg-[var(--bad)]/10 px-3 py-2 text-sm text-[var(--bad)]">
          {err || errorMessage}
        </p>
      )}

      <button
        type="button"
        disabled={loading}
        onClick={() => void signInWithGoogle()}
        className="flex items-center justify-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
      >
        <GoogleIcon />
        {loading ? 'Redirecting…' : 'Continue with Google'}
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c3.382-3.117 5.33-7.704 5.33-13.132z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="p-8 text-[var(--muted)]">Loading…</p>}>
      <LoginForm />
    </Suspense>
  );
}
