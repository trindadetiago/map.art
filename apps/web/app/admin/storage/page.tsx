import { repos } from '@mapart/db';
import { env } from '@mapart/env';
import { getStorage } from '@mapart/storage';
import { revalidatePath } from 'next/cache';
import { type StorageEntryWire, StoragePanel } from './panel';

export const dynamic = 'force-dynamic';

async function deleteAction(key: string): Promise<void> {
  'use server';
  await getStorage().delete(key);
  revalidatePath('/admin/storage');
}

function deriveConsoleUrl(endpoint: string | undefined): string | null {
  if (!endpoint) return null;
  try {
    const u = new URL(endpoint);
    const apiPort = Number.parseInt(u.port || '9000', 10);
    return `${u.protocol}//${u.hostname}:${apiPort + 1}`;
  } catch {
    return null;
  }
}

export default async function StoragePage() {
  let entries: StorageEntryWire[] = [];
  let error: string | null = null;
  try {
    const raw = await getStorage().list('');
    entries = raw.map((e) => ({
      key: e.key,
      size: e.size,
      modifiedAtIso: e.modifiedAt.toISOString(),
    }));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // Resolve the project UUIDs that appear in keys (render/{id}/…, stylize/{id}/…)
  // to human names so the tree reads as project names, not opaque ids.
  let projectNames: Record<string, string> = {};
  try {
    projectNames = Object.fromEntries((await repos.listProjects()).map((p) => [p.id, p.name]));
  } catch {
    // DB unreachable — fall back to showing raw ids.
  }

  const consoleUrl = deriveConsoleUrl(env.s3Endpoint);
  const totalBytes = entries.reduce((a, e) => a + e.size, 0);

  return (
    <div>
      <div className="mb-10 flex items-baseline gap-4">
        <h1 className="m-0 text-3xl font-light tracking-tight text-stone-900">Storage</h1>
        <span className="text-sm text-stone-500">
          {error
            ? 'storage unreachable'
            : `${entries.length.toLocaleString()} files · ${formatBytes(totalBytes)}`}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 font-mono text-[11px] text-stone-600">
            s3{env.s3Bucket ? ` · ${env.s3Bucket}` : ''}
          </span>
          {consoleUrl && (
            <a
              href={consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-stone-200 bg-white px-3 py-1 text-[11px] text-stone-700 no-underline transition hover:border-stone-400"
            >
              MinIO console ↗
            </a>
          )}
        </span>
      </div>

      {error ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white/40 p-12 text-center">
          <div className="text-[15px] font-medium text-stone-700">Storage is unreachable</div>
          <p className="mx-auto mt-2 max-w-[44ch] text-sm text-stone-500">{error}</p>
        </div>
      ) : (
        <StoragePanel
          entries={entries}
          deleteAction={deleteAction}
          serveUrlPrefix="/api/storage/"
          projectNames={projectNames}
        />
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
