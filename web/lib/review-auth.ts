import { NextRequest, NextResponse } from 'next/server';

import { isEmailAllowlisted } from '@/lib/auth-allowlist';
import { createSupabaseRouteHandlerClient } from '@/lib/supabase-ssr';

export function reviewAuthUnauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function hasSupabaseAuthCookie(req: NextRequest): boolean {
  const prefix = 'sb-';
  return req.cookies.getAll().some((c) => c.name.startsWith(prefix) && c.name.includes('auth-token'));
}

export function isReviewAuthorized(req: NextRequest): boolean {
  return hasSupabaseAuthCookie(req);
}

/** Returns a NextResponse if request is forbidden; otherwise null. */
export function assertReviewAuthorized(req: NextRequest): NextResponse | null {
  if (!isReviewAuthorized(req)) {
    return reviewAuthUnauthorized();
  }
  return null;
}

export async function getCurrentUserEmail(req: NextRequest): Promise<string | null> {
  if (!hasSupabaseAuthCookie(req)) return null;

  const supabase = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user?.email) return null;
  if (!isEmailAllowlisted(user.email)) return null;
  return user.email.trim().toLowerCase();
}
