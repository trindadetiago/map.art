/**
 * Failed-login throttle for the password gate.
 *
 * The gate is a single shared password with no lockout of its own, so an
 * unbounded guessing loop is the cheapest way through it. State lives in memory
 * on one instance: it resets on redeploy and isn't shared across replicas,
 * which is a real limit — but it still turns "guess forever" into a handful of
 * attempts per window, which is the attack worth stopping.
 */

const WINDOW_MS = 15 * 60 * 1000;
/** Failures from one address before it has to wait the window out. */
const PER_IP_MAX = 8;
/** Failures across all addresses — a backstop against a spread-out attempt. */
const GLOBAL_MAX = 60;
/** Bound the map so a spray of addresses can't grow it without limit. */
const MAX_TRACKED = 10_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const perIp = new Map<string, Bucket>();
let overall: Bucket = { count: 0, resetAt: 0 };

/** The live bucket, or a fresh one if its window has rolled over. */
function current(bucket: Bucket | undefined, now: number): Bucket {
  return bucket && bucket.resetAt > now ? bucket : { count: 0, resetAt: now + WINDOW_MS };
}

function sweep(now: number): void {
  if (perIp.size < MAX_TRACKED) return;
  for (const [ip, bucket] of perIp) {
    if (bucket.resetAt <= now) perIp.delete(ip);
  }
}

/**
 * Client address as the platform's proxy saw it. `x-forwarded-for` grows
 * left-to-right as it crosses proxies, so the *last* entry is the one our own
 * edge appended; anything earlier is whatever the caller chose to send.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    const nearest = hops[hops.length - 1];
    if (nearest) return nearest;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Milliseconds this address must wait before guessing again; 0 if it may try now. */
export function loginRetryAfterMs(ip: string): number {
  const now = Date.now();
  const global = current(overall, now);
  if (global.count >= GLOBAL_MAX) return global.resetAt - now;
  const bucket = current(perIp.get(ip), now);
  return bucket.count >= PER_IP_MAX ? bucket.resetAt - now : 0;
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  sweep(now);
  overall = current(overall, now);
  overall.count++;
  const bucket = current(perIp.get(ip), now);
  bucket.count++;
  perIp.set(ip, bucket);
}

/** A correct password clears that address; the global backstop still decays on its own. */
export function clearLoginFailures(ip: string): void {
  perIp.delete(ip);
}
