import { NextResponse, type NextRequest } from 'next/server';

import { isReviewAuthorized } from '@/lib/review-auth';

const secret = process.env.REVIEW_DASHBOARD_SECRET?.trim();

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (path === '/content/review/unlock') {
    return NextResponse.next();
  }
  if (path === '/api/content-review/unlock' || path === '/api/content-review/logout') {
    return NextResponse.next();
  }

  if (!secret) {
    return NextResponse.next();
  }

  if (path.startsWith('/content/review')) {
    if (isReviewAuthorized(req)) return NextResponse.next();
    const u = new URL('/content/review/unlock', req.url);
    u.searchParams.set('next', path);
    return NextResponse.redirect(u);
  }

  if (path.startsWith('/content/assets')) {
    if (isReviewAuthorized(req)) return NextResponse.next();
    const u = new URL('/content/review/unlock', req.url);
    u.searchParams.set('next', path);
    return NextResponse.redirect(u);
  }

  if (path.startsWith('/api/content-review')) {
    if (isReviewAuthorized(req)) return NextResponse.next();
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (path.startsWith('/api/content-assets')) {
    if (isReviewAuthorized(req)) return NextResponse.next();
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/content/review',
    '/content/review/:path*',
    '/content/assets',
    '/content/assets/:path*',
    '/api/content-review/:path*',
    '/api/content-assets/:path*',
  ],
};
