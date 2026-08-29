/**
 * Liveness probe for the platform healthcheck. Deliberately outside the
 * `APP_PASSWORD` gate — the gate answers `/` with a redirect to `/login`, which
 * a healthcheck reads as unhealthy — and it touches nothing (no db, no storage)
 * so it reports on this process only.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return new Response('ok', {
    status: 200,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}
