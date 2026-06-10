'use client';

import type { LatLng } from '@mapart/geo';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelAll,
  restyleAll,
  restylizeTile,
  resumeAll,
  resumeTile,
  retryProjectErrors,
  retryTile,
} from './actions';
import { AreaScene, type OverlayTile } from './area_scene';

export interface TileLite {
  x: number;
  y: number;
  currentStatusType: 'render' | 'stylize';
  status: 'pending' | 'progress' | 'done' | 'error';
  renderedImgPath: string | null;
  stylizedImgPath: string | null;
}

type View = 'stylized' | 'render';
interface Menu {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
}

const isTerminal = (t: TileLite): boolean =>
  (t.currentStatusType === 'stylize' && t.status === 'done') || t.status === 'error';

/** Cancelled = the signature `Cancel all` leaves: stylize/done with no output. */
const isCancelled = (t: TileLite): boolean =>
  t.currentStatusType === 'stylize' && t.status === 'done' && !t.stylizedImgPath;

export function StepBuild({
  apiKey,
  center,
  projectId,
  projectName,
  cols,
  rows,
  initialTiles,
}: {
  apiKey: string;
  center: LatLng;
  projectId: string;
  projectName: string;
  cols: number;
  rows: number;
  initialTiles: TileLite[];
}) {
  const [tiles, setTiles] = useState<TileLite[]>(initialTiles);
  const [view, setView] = useState<View>('stylized');
  const [dimOutside, setDimOutside] = useState(false);
  const [showLines, setShowLines] = useState(true);
  // On by default: the live Google 3D map is the only paid (Map Tiles API) part
  // of this view, and you don't need it to watch tile progress. Hiding it streams
  // nothing — overlays render on black.
  const [hideMap, setHideMap] = useState(true);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [errorMenu, setErrorMenu] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{ x: number; y: number } | null>(null);
  // Per-phase cursor so repeated clicks cycle through the in-progress tiles.
  const focusCursor = useRef<{ render: number; stylize: number }>({ render: 0, stylize: 0 });
  // Bumping this re-arms the poll loop after a manual re-stylize (which makes a
  // finished project active again).
  const [pollNonce, setPollNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pollNonce re-arms the loop after a manual re-stylize
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finished = (ts: TileLite[]): boolean => ts.length > 0 && ts.every(isTerminal);

    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/projects/${projectId}/tiles`, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { tiles: TileLite[] };
          if (stopped) return;
          setTiles(data.tiles);
          if (finished(data.tiles)) return; // terminal — stop polling
        }
      } catch {
        // network blip — keep polling
      }
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, pollNonce]);

  // Each tile painted onto its footprint over the live city. In stylized view,
  // status drives the look (stylized image / dimmed render / pulsing amber
  // in-progress / grey pending / red error). In render view, every rendered
  // tile shows its raw render at full opacity.
  const overlay = useMemo<OverlayTile[]>(
    () =>
      tiles.map((t) => {
        const rendered = t.renderedImgPath ? `/api/storage/${t.renderedImgPath}` : null;
        const stylized = t.stylizedImgPath ? `/api/storage/${t.stylizedImgPath}` : null;
        if (t.status === 'error') return { x: t.x, y: t.y, state: 'error', imageUrl: null };

        if (view === 'render') {
          if (rendered) return { x: t.x, y: t.y, state: 'stylized', imageUrl: rendered }; // full image
          if (t.status === 'progress') return { x: t.x, y: t.y, state: 'progress', imageUrl: null };
          return { x: t.x, y: t.y, state: 'pending', imageUrl: null };
        }

        // A tile actively (re)stylizing pulses amber even if it still holds an
        // old image — otherwise a re-stylize looks like nothing is happening.
        if (t.currentStatusType === 'stylize' && t.status === 'progress')
          return { x: t.x, y: t.y, state: 'stylizing', imageUrl: rendered ?? stylized };
        // Re-queued for restyle: drop back to the render so it visibly reverts
        // while it waits (the DB still keeps the old image for neighbour context).
        if (t.currentStatusType === 'stylize' && t.status === 'pending' && rendered)
          return { x: t.x, y: t.y, state: 'rendered', imageUrl: rendered };
        if (stylized) return { x: t.x, y: t.y, state: 'stylized', imageUrl: stylized };
        if (rendered) return { x: t.x, y: t.y, state: 'rendered', imageUrl: rendered };
        if (t.status === 'progress') return { x: t.x, y: t.y, state: 'progress', imageUrl: null };
        return { x: t.x, y: t.y, state: 'pending', imageUrl: null };
      }),
    [tiles, view],
  );

  // Counts a finished stylization only — re-queued tiles (still holding their old
  // image in the DB) drop out until they're redone, matching the reverted view.
  const stylizedCount = tiles.filter((t) => t.stylizedImgPath && t.status === 'done').length;
  const renderedCount = tiles.filter((t) => t.renderedImgPath).length;
  const renderErrors = tiles.filter(
    (t) => t.status === 'error' && t.currentStatusType === 'render',
  ).length;
  const stylizeErrors = tiles.filter(
    (t) => t.status === 'error' && t.currentStatusType === 'stylize',
  ).length;
  const errors = renderErrors + stylizeErrors;
  const total = cols * rows;

  const rendering = tiles.filter(
    (t) => t.currentStatusType === 'render' && t.status === 'progress',
  );
  const stylizing = tiles.filter(
    (t) => t.currentStatusType === 'stylize' && t.status === 'progress',
  );
  const stylizePhase = tiles.filter((t) => t.currentStatusType === 'stylize');
  const pendingStylize = stylizePhase.filter((t) => t.status === 'pending').length;
  const cancelledCount = tiles.filter(isCancelled).length;

  // Jump the camera to an in-progress tile, cycling through them on each click.
  function focusInProgress(phase: 'render' | 'stylize'): void {
    const list = phase === 'render' ? rendering : stylizing;
    if (list.length === 0) return;
    const i = focusCursor.current[phase] % list.length;
    focusCursor.current[phase] = i + 1;
    const t = list[i];
    if (t) setFocusTarget({ x: t.x, y: t.y });
  }

  async function doRestylize(x: number, y: number): Promise<void> {
    setMenu(null);
    // Optimistic: drop the tile back so it reads as re-queued immediately.
    setTiles((ts) =>
      ts.map((t) =>
        t.x === x && t.y === y ? { ...t, status: 'pending', stylizedImgPath: null } : t,
      ),
    );
    await restylizeTile({ projectId, x, y });
    setPollNonce((n) => n + 1); // re-arm polling to follow the re-stylize
  }

  async function doRetry(x: number, y: number): Promise<void> {
    setMenu(null);
    // Optimistic: clear the error so the tile reads as re-queued immediately.
    setTiles((ts) => ts.map((t) => (t.x === x && t.y === y ? { ...t, status: 'pending' } : t)));
    await retryTile({ projectId, x, y });
    setPollNonce((n) => n + 1); // re-arm polling to follow the retry
  }

  async function doRetryErrors(phase: 'all' | 'render' | 'stylize'): Promise<void> {
    setErrorMenu(false);
    // Optimistic: flip the matching errored tiles back to pending.
    setTiles((ts) =>
      ts.map((t) => {
        if (t.status !== 'error') return t;
        if (phase !== 'all' && t.currentStatusType !== phase) return t;
        return { ...t, status: 'pending' };
      }),
    );
    await retryProjectErrors({ projectId, phase });
    setPollNonce((n) => n + 1); // re-arm polling to follow the retries
  }

  async function doRestyleAll(): Promise<void> {
    if (stylizePhase.length === 0) return;
    if (
      !confirm(`Re-stylize all ${stylizePhase.length} tiles? This re-runs the model on every one.`)
    )
      return;
    // Optimistic: re-queue (keep images so the view doesn't blank).
    setTiles((ts) =>
      ts.map((t) => (t.currentStatusType === 'stylize' ? { ...t, status: 'pending' } : t)),
    );
    await restyleAll({ projectId });
    setPollNonce((n) => n + 1);
  }

  async function doCancelAll(): Promise<void> {
    // Optimistic: drop pending stylize tiles to done so they stop being claimed.
    setTiles((ts) =>
      ts.map((t) =>
        t.currentStatusType === 'stylize' && t.status === 'pending' ? { ...t, status: 'done' } : t,
      ),
    );
    await cancelAll({ projectId });
    setPollNonce((n) => n + 1);
  }

  async function doResumeAll(): Promise<void> {
    // Optimistic: cancelled tiles drop back to pending so they read as queued.
    setTiles((ts) => ts.map((t) => (isCancelled(t) ? { ...t, status: 'pending' } : t)));
    await resumeAll({ projectId });
    setPollNonce((n) => n + 1); // re-arm polling to follow the resumed work
  }

  async function doResume(x: number, y: number): Promise<void> {
    setMenu(null);
    // Optimistic: the tile drops back to pending so it reads as queued immediately.
    setTiles((ts) => ts.map((t) => (t.x === x && t.y === y ? { ...t, status: 'pending' } : t)));
    await resumeTile({ projectId, x, y });
    setPollNonce((n) => n + 1); // re-arm polling to follow the resumed tile
  }

  const menuTile = menu ? (tiles.find((t) => t.x === menu.x && t.y === menu.y) ?? null) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-stone-200 border-b px-5 py-4">
        <div>
          <div className="text-[15px] font-semibold text-stone-900">{projectName}</div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-stone-500">
            <span>
              {stylizedCount}/{total} stylized · {renderedCount}/{total} rendered
            </span>
            <InProgress
              label="stylizing"
              count={stylizing.length}
              color="amber"
              onClick={() => focusInProgress('stylize')}
            />
            <InProgress
              label="rendering"
              count={rendering.length}
              color="sky"
              onClick={() => focusInProgress('render')}
            />
            {pendingStylize > 0 && (
              <span className="text-stone-400">· {pendingStylize} queued</span>
            )}
            {errors > 0 && (
              <ErrorMenu
                open={errorMenu}
                onToggle={() => setErrorMenu((v) => !v)}
                onClose={() => setErrorMenu(false)}
                total={errors}
                renderErrors={renderErrors}
                stylizeErrors={stylizeErrors}
                onRetry={doRetryErrors}
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'stylized', label: 'Stylized' },
              { value: 'render', label: 'Render' },
            ]}
          />
          <Toggle on={hideMap} onClick={() => setHideMap((v) => !v)}>
            Hide map
          </Toggle>
          {!hideMap && (
            <Toggle on={dimOutside} onClick={() => setDimOutside((v) => !v)}>
              Focus area
            </Toggle>
          )}
          <Toggle on={showLines} onClick={() => setShowLines((v) => !v)}>
            Grid
          </Toggle>

          <span className="mx-1 h-5 w-px bg-stone-200" />

          {pendingStylize > 0 && (
            <button
              type="button"
              onClick={doCancelAll}
              className="h-8 rounded-full border border-red-200 bg-red-50 px-3 text-[12px] text-red-700 transition hover:border-red-400 hover:bg-red-100"
            >
              Cancel all
            </button>
          )}
          {cancelledCount > 0 && (
            <button
              type="button"
              onClick={doResumeAll}
              className="h-8 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-[12px] text-emerald-700 transition hover:border-emerald-400 hover:bg-emerald-100"
            >
              Resume all ({cancelledCount})
            </button>
          )}
          <button
            type="button"
            onClick={doRestyleAll}
            disabled={stylizePhase.length === 0}
            className="h-8 rounded-full bg-stone-900 px-3 text-[12px] text-white transition hover:bg-stone-700 disabled:opacity-40"
          >
            Restyle all
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-stone-900">
        <AreaScene
          apiKey={apiKey}
          center={center}
          cols={cols}
          rows={rows}
          interactive={false}
          overlay={overlay}
          dimOutside={dimOutside}
          showLines={showLines}
          showMap={!hideMap}
          focusTarget={focusTarget}
          onTileContext={(x, y, clientX, clientY) => {
            const t = tiles.find((tile) => tile.x === x && tile.y === y);
            if (t && (t.status === 'error' || t.stylizedImgPath || isCancelled(t)))
              setMenu({ x, y, clientX, clientY });
          }}
        />
      </div>

      {menu && (
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: click-away backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            className="fixed z-50 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg"
            style={{ left: menu.clientX, top: menu.clientY }}
          >
            {menuTile?.status === 'error' ? (
              <button
                type="button"
                onClick={() => doRetry(menu.x, menu.y)}
                className="block w-full px-4 py-2 text-left text-[13px] text-red-700 hover:bg-red-50"
              >
                Retry tile {menu.x},{menu.y}
              </button>
            ) : menuTile && isCancelled(menuTile) ? (
              <button
                type="button"
                onClick={() => doResume(menu.x, menu.y)}
                className="block w-full px-4 py-2 text-left text-[13px] text-emerald-700 hover:bg-emerald-50"
              >
                Resume tile {menu.x},{menu.y}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => doRestylize(menu.x, menu.y)}
                className="block w-full px-4 py-2 text-left text-[13px] text-stone-800 hover:bg-stone-100"
              >
                Re-stylize tile {menu.x},{menu.y}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The error count, clickable to open a bulk-retry menu. Offers per-phase retries
 * when both phases have errors; when only one phase does, just that option.
 */
function ErrorMenu({
  open,
  onToggle,
  onClose,
  total,
  renderErrors,
  stylizeErrors,
  onRetry,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  total: number;
  renderErrors: number;
  stylizeErrors: number;
  onRetry: (phase: 'all' | 'render' | 'stylize') => void;
}) {
  const options: { label: string; phase: 'all' | 'render' | 'stylize' }[] = [];
  if (renderErrors > 0 && stylizeErrors > 0) {
    options.push({ label: `Retry all (${total})`, phase: 'all' });
    options.push({ label: `Retry all render errors (${renderErrors})`, phase: 'render' });
    options.push({ label: `Retry all stylize errors (${stylizeErrors})`, phase: 'stylize' });
  } else if (renderErrors > 0) {
    options.push({ label: `Retry all render errors (${renderErrors})`, phase: 'render' });
  } else if (stylizeErrors > 0) {
    options.push({ label: `Retry all stylize errors (${stylizeErrors})`, phase: 'stylize' });
  }

  return (
    <span className="relative inline-flex items-center gap-1.5">
      <span className="text-stone-300">·</span>
      <button
        type="button"
        onClick={onToggle}
        title="Retry errored tiles"
        className="rounded px-1 text-red-600 hover:bg-red-50"
      >
        {total} error
      </button>
      {open && (
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: click-away backdrop */}
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div className="absolute top-full left-0 z-50 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg">
            {options.map((o) => (
              <button
                key={o.phase}
                type="button"
                onClick={() => onRetry(o.phase)}
                className="block w-full px-4 py-2 text-left text-[13px] text-stone-800 hover:bg-stone-100"
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

/** A live in-progress count. Clickable (when > 0) to jump the camera to one. */
function InProgress({
  label,
  count,
  color,
  onClick,
}: {
  label: string;
  count: number;
  color: 'amber' | 'sky';
  onClick: () => void;
}) {
  const accent =
    color === 'amber' ? 'text-amber-700 hover:bg-amber-50' : 'text-sky-700 hover:bg-sky-50';
  const dot = color === 'amber' ? 'bg-amber-500' : 'bg-sky-500';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-stone-300">·</span>
      {count === 0 ? (
        <span className="text-stone-400">0 {label}</span>
      ) : (
        <button
          type="button"
          onClick={onClick}
          title={`Jump to a ${label} tile`}
          className={`inline-flex items-center gap-1 rounded px-1 ${accent}`}
        >
          <span className={`inline-block h-1.5 w-1.5 animate-pulse rounded-full ${dot}`} />
          {count} {label}
        </button>
      )}
    </span>
  );
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-full border px-3 text-[12px] transition ${
        on
          ? 'border-stone-900 bg-stone-900 text-white'
          : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'
      }`}
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex h-8 items-center rounded-full border border-stone-200 bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`h-7 rounded-full px-3 text-[12px] transition ${
            value === o.value ? 'bg-stone-900 text-white' : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
