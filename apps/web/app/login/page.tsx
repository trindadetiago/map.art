import { AUTH_COOKIE, AUTH_MAX_AGE_SECONDS, authToken } from '@/lib/auth';
import {
  clearLoginFailures,
  clientIp,
  loginRetryAfterMs,
  recordLoginFailure,
} from '@/lib/rate_limit';
import { requireEnv } from '@mapart/env';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

function safeNext(next: string | undefined): string {
  // Same-site paths only. Resolving against a dummy origin normalises what a
  // prefix check misses — a browser reads `/\evil.com` as `//evil.com` and
  // leaves the site, so compare the resolved origin rather than the raw string.
  if (!next) return '/';
  try {
    const url = new URL(next, 'http://localhost');
    if (url.origin !== 'http://localhost') return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

async function login(formData: FormData) {
  'use server';

  const next = safeNext(formData.get('next')?.toString());
  const ip = clientIp(await headers());

  const waitMs = loginRetryAfterMs(ip);
  if (waitMs > 0) {
    const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
    redirect(`/login?error=rate&retry=${minutes}&next=${encodeURIComponent(next)}`);
  }

  const password = formData.get('password');
  const expected = requireEnv('appPassword');

  if (typeof password !== 'string' || password !== expected) {
    recordLoginFailure(ip);
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  clearLoginFailures(ip);
  const jar = await cookies();
  jar.set(AUTH_COOKIE, await authToken(expected), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: AUTH_MAX_AGE_SECONDS,
  });

  redirect(next);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; retry?: string }>;
}) {
  const { next, error, retry } = await searchParams;
  const minutes = Number(retry) || 15;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fcfcfc] p-6">
      <form
        action={login}
        className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900">earthToPixels</h1>
        <p className="mt-1 text-sm text-neutral-500">Enter the password to continue.</p>

        <input type="hidden" name="next" value={safeNext(next)} />

        <input
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Password"
          className="mt-6 w-full rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
        />

        {error === 'rate' ? (
          <p className="mt-2 text-sm text-red-600">
            Too many attempts. Try again in {minutes} minute{minutes === 1 ? '' : 's'}.
          </p>
        ) : error ? (
          <p className="mt-2 text-sm text-red-600">Incorrect password.</p>
        ) : null}

        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
        >
          Continue
        </button>
      </form>
    </main>
  );
}
