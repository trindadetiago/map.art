import { AUTH_COOKIE, AUTH_MAX_AGE_SECONDS, authToken } from '@/lib/auth';
import { requireEnv } from '@mapart/env';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

function safeNext(next: string | undefined): string {
  // Only allow same-site relative paths, never an open redirect.
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/';
}

async function login(formData: FormData) {
  'use server';

  const password = formData.get('password');
  const next = safeNext(formData.get('next')?.toString());
  const expected = requireEnv('appPassword');

  if (typeof password !== 'string' || password !== expected) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

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
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

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

        {error ? <p className="mt-2 text-sm text-red-600">Incorrect password.</p> : null}

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
