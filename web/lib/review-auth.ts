import { NextRequest, NextResponse } from 'next/server';

export function reviewAuthUnauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

const COOKIE = 'fr94_review_auth';

export function isReviewAuthorized(req: NextRequest): boolean {
  const secret = process.env.REVIEW_DASHBOARD_SECRET?.trim();
  if (!secret) return true;

  const bearer = req.headers.get('authorization');
  const headerToken =
    bearer?.startsWith('Bearer ') ? bearer.slice(7).trim() : req.headers.get('x-review-secret');

  if (headerToken === secret) return true;

  const cookieVal = req.cookies.get(COOKIE)?.value;
  return cookieVal === secret;
}

/** Returns a NextResponse if request is forbidden; otherwise null. */
export function assertReviewAuthorized(req: NextRequest): NextResponse | null {
  if (!isReviewAuthorized(req)) {
    return reviewAuthUnauthorized();
  }
  return null;
}

export { COOKIE as REVIEW_AUTH_COOKIE_NAME };
