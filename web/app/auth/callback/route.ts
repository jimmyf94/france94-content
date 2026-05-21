import { NextRequest, NextResponse } from 'next/server';

import { isEmailAllowlisted } from '@/lib/auth-allowlist';
import { createSupabaseRouteHandlerClient } from '@/lib/supabase-ssr';

function safeNextPath(raw: string | null): string {
  if (!raw?.startsWith('/') || raw.startsWith('//')) return '/content/review';
  return raw;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'));

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=auth_failed', req.url));
  }

  const supabase = await createSupabaseRouteHandlerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession', error);
    return NextResponse.redirect(new URL('/login?error=auth_failed', req.url));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !isEmailAllowlisted(user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/login?error=not_allowed', req.url));
  }

  return NextResponse.redirect(new URL(next, req.url));
}
