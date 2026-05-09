import { NextResponse } from 'next/server';

import { REVIEW_AUTH_COOKIE_NAME } from '@/lib/review-auth';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(REVIEW_AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
