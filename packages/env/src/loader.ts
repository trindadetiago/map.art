import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Walks up from this file to find the monorepo root (marked by pnpm-workspace.yaml). */
export function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    '@mapart/env: could not locate monorepo root (no pnpm-workspace.yaml found walking up)',
  );
}

let loaded = false;

/** Parses the root .env file and populates process.env for any keys not already set. Idempotent. */
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;

  const root = findRepoRoot();
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
