'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Status = 'queued' | 'running' | 'done' | 'error';

interface ExportState {
  id: string;
  status: Status;
  source: string;
  error: string | null;
  placed: number | null;
  uploaded: number | null;
  createdAt: string;
  finishedAt: string | null;
  /** In a live state but too old to still be running — the runner died silently. */
  stale: boolean;
}

/** While a run is in flight; polling stops once it reaches a terminal state. */
const POLL_MS = 5000;

/**
 * Step 6 — Publish. Rebuilds the project's deep-zoom pyramid and uploads it to
 * the bucket the visualizer serves from.
 *
 * Edits made in Review change a project's *source* tiles; the public map is a
 * pyramid stitched from them at export time, so nothing on the visualizer moves
 * until an export runs. That's what this does.
 *
 * The export is far too heavy for this process, so it runs on a separate service
 * and reports progress by writing to its own row — which is what this polls.
 */
export function StepPublish({
  projectId,
  projectSlug,
}: {
  projectId: string;
  projectSlug?: string;
}) {
  const [state, setState] = useState<ExportState | null>(null);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/export`, { cache: 'no-store' });
      const body = await res.json();
      if (body.ok) {
        setState(body.export);
        setConfigured(body.configured);
      }
    } catch {
      /* a failed poll is not worth surfacing — the next one will land */
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while something is actually in flight.
  useEffect(() => {
    const live = state && !state.stale && (state.status === 'queued' || state.status === 'running');
    if (!live) return;
    timer.current = setTimeout(() => void load(), POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, load]);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/export`, { method: 'POST' });
      const body = await res.json();
      if (!body.ok) setError(body.error ?? 'could not start the export');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const running =
    !!state && !state.stale && (state.status === 'queued' || state.status === 'running');

  return (
    <div className="max-w-2xl">
      <h2 className="m-0 text-lg font-medium tracking-tight text-stone-900">Publish</h2>
      <p className="mt-1 mb-6 text-[13px] leading-relaxed text-stone-500">
        Edits in Review and Pins change this project&apos;s source tiles. The public map is built
        from them, so it only changes when you rebuild it here.
      </p>

      {!configured && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
          Publishing isn&apos;t configured on this deployment — <code>RAILWAY_API_TOKEN</code> is
          unset. Run it from a terminal instead:
          <pre className="mt-2 mb-0 overflow-x-auto rounded-lg bg-amber-100/60 p-2 font-mono text-[12px]">
            node scripts/export-on-railway.mjs {projectId}
          </pre>
        </div>
      )}

      <button
        type="button"
        onClick={start}
        disabled={busy || running || !configured}
        className="h-10 rounded-full bg-stone-900 px-6 text-[13px] text-white transition hover:bg-stone-700 disabled:opacity-40"
      >
        {running ? 'Rebuilding…' : busy ? 'Starting…' : 'Rebuild the map'}
      </button>

      {error && <p className="mt-3 mb-0 text-[12px] text-red-600">{error}</p>}

      {state && (
        <div className="mt-6 rounded-2xl border border-stone-200/70 bg-white p-5">
          <div className="flex items-center gap-2">
            <StatusDot status={state.stale ? 'error' : state.status} />
            <span className="text-[13px] font-medium text-stone-900">{label(state)}</span>
            <span className="text-[11px] text-stone-400">{when(state)}</span>
          </div>

          {state.status === 'done' && (
            <p className="mt-2 mb-0 text-[12px] text-stone-500">
              {state.placed?.toLocaleString()} tiles stitched · {state.uploaded?.toLocaleString()}{' '}
              objects uploaded
              {projectSlug && (
                <>
                  {' · '}
                  <a
                    href={`https://earthtopixels.com/${projectSlug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-stone-700 underline underline-offset-4"
                  >
                    view it
                  </a>
                </>
              )}
            </p>
          )}

          {state.stale && (
            <p className="mt-2 mb-0 text-[12px] text-stone-500">
              No result was recorded and the run is too old to still be going — the runner most
              likely failed to start. Check its logs, then try again.
            </p>
          )}

          {state.status === 'error' && state.error && (
            <p className="mt-2 mb-0 font-mono text-[12px] text-red-600">{state.error}</p>
          )}

          {running && (
            <p className="mt-2 mb-0 text-[12px] text-stone-500">
              This takes several minutes — the whole map is stitched and re-sliced. You can leave
              this page; progress is picked up when you come back.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function label(e: ExportState): string {
  if (e.stale) return 'Export did not finish';
  if (e.status === 'queued') return 'Queued';
  if (e.status === 'running') return 'Rebuilding the map';
  if (e.status === 'done') return 'Map is up to date';
  return 'Export failed';
}

function when(e: ExportState): string {
  const d = new Date(e.finishedAt ?? e.createdAt);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function StatusDot({ status }: { status: Status }): React.ReactElement {
  const tone =
    status === 'done'
      ? 'bg-emerald-500'
      : status === 'error'
        ? 'bg-red-500'
        : 'bg-amber-400 animate-pulse';
  return <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} />;
}
