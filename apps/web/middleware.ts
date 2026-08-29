import { AUTH_COOKIE, authToken } from '@/lib/auth';
import { type NextRequest, NextResponse } from 'next/server';

const LOGIN_PATH = '/login';

/**
 * Whole-site password gate. Active only when `APP_PASSWORD` is set, so local dev
 * stays open. Read straight from `process.env` because the Edge runtime can't run
 * the filesystem-based `@mapart/env` loader; the canonical schema entry still
 * lives in `packages/env` for the docs/debug panel.
 */
export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  if (req.nextUrl.pathname === LOGIN_PATH) return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && cookie === (await authToken(password))) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  url.search = '';
  url.searchParams.set('next', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on every request except the healthcheck, Next internals and static assets.
  matcher: [
    '/((?!api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
