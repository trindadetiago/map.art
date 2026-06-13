/**
 * Shared password gate primitives. Kept dependency-free (Web Crypto only, no
 * `@mapart/env`, no `node:*`) so this module is safe to import from both the
 * Edge middleware and Node server actions.
 */

export const AUTH_COOKIE = 'mapart_auth';

/** Days the auth cookie stays valid before a fresh login is required. */
export const AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Deterministic, non-reversible token stored in the auth cookie. The middleware
 * recomputes it from `APP_PASSWORD` and compares, so the plaintext password
 * never lives in the cookie.
 */
export async function authToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`mapart:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
