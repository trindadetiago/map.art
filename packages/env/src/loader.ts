import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walks up from this file looking for the monorepo root (marked by
 * pnpm-workspace.yaml), or undefined when there isn't one to find.
 *
 * A bundled deployment traces only the modules it needs, so the workspace
 * marker is often absent — the code is running from somewhere that has no repo
 * around it. Callers that merely want the root if it exists use this.
 */
export function tryFindRepoRoot(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * The monorepo root, for callers that genuinely need files from it — migrations
 * read their SQL from the repo, so there is nothing sensible to do without it.
 */
export function findRepoRoot(): string {
  const root = tryFindRepoRoot();
  if (!root) {
    throw new Error(
      '@mapart/env: could not locate monorepo root (no pnpm-workspace.yaml found walking up)',
    );
  }
  return root;
}

let loaded = false;

/** Parses the root .env file and populates process.env for any keys not already set. Idempotent. */
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;

  // No repo root means no `.env` to read — a deployed app is handed its
  // configuration by the platform. Treating that as fatal took down every
  // request on a host that bundles rather than checking the repo out.
  const root = tryFindRepoRoot();
  if (!root) return;
  const envPath = resolve(root, '.env');

  if (!existsSync(envPath)) return;
  if (!statSync(envPath).isFile()) return;

  const contents = readFileSync(envPath, 'utf8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    const value = raw.replace(/^['"]|['"]$/g, '');
    const current = process.env[key];
    if (current === undefined || current === '') {
      process.env[key] = value;
    }
  }
}
