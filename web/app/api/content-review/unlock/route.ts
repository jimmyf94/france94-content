import { NextRequest, NextResponse } from 'next/server';

import { REVIEW_AUTH_COOKIE_NAME } from '@/lib/review-auth';

export async function POST(req: NextRequest) {
  const secret = process.env.REVIEW_DASHBOARD_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ ok: true, message: 'Dashboard secret not configured; no unlock needed.' });
  }

  let body: { secret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.secret !== secret) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(REVIEW_AUTH_COOKIE_NAME, secret, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
