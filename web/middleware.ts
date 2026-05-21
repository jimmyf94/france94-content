import { NextResponse, type NextRequest } from 'next/server';

import { isEmailAllowlisted } from '@/lib/auth-allowlist';
import { createSupabaseMiddlewareClient } from '@/lib/supabase-ssr';

function loginRedirect(req: NextRequest, path: string): NextResponse {
  const u = new URL('/login', req.url);
  u.searchParams.set('next', path);
  return NextResponse.redirect(u);
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const res = NextResponse.next({ request: req });

  const supabase = createSupabaseMiddlewareClient(req, res);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !isEmailAllowlisted(user.email)) {
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return loginRedirect(req, path);
  }

  return res;
}

export const config = {
  matcher: [
    '/content/review',
    '/content/review/:path*',
    '/content/assets',
    '/content/assets/:path*',
    '/content/publishing',
    '/content/publishing/:path*',
    '/api/content-review/:path*',
    '/api/content-assets/:path*',
  ],
};
