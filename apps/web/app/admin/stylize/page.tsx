import { repos } from '@mapart/db';
import { getStorage } from '@mapart/storage';
import { stylizeKey, stylizeStepKey } from '@mapart/stylize';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type Search = { project?: string; tile?: string };

/** A single inspectable image in a tile's history. */
interface Stage {
  label: string;
  hint: string;
  key: string | null;
  present: boolean;
}

/** Map a storage key to the byte-serving API route (each path segment encoded). */
function blobUrl(key: string): string {
  return `/api/storage/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** Parse the `x_y` tile selector into coordinates. */
function parseTile(sel: string | undefined): { x: number; y: number } | null {
  if (!sel) return null;
  const m = sel.match(/^(-?\d+)_(-?\d+)$/);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

export default async function StylizeHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { project: projectId, tile: tileSel } = await searchParams;
  const projects = await repos.listProjects();
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined;
  const tiles = project ? await repos.tilesByProject(project.id) : [];
  const coords = parseTile(tileSel);
  const tile = coords ? tiles.find((t) => t.x === coords.x && t.y === coords.y) : undefined;

  let stages: Stage[] = [];
  if (project && tile) {
    const finalKey = tile.stylizedImgPath ?? stylizeKey(project.id, tile.x, tile.y);
    const candidates: Omit<Stage, 'present'>[] = [
      { label: 'Raw input', hint: 'rendered tile (input)', key: tile.renderedImgPath },
      {
        label: 'Composite',
        hint: 'fed to model + red box',
        key: stylizeStepKey(project.id, tile.x, tile.y, 'composite'),
      },
      {
        label: 'Raw output',
        hint: 'model output, pre-crop',
        key: stylizeStepKey(project.id, tile.x, tile.y, 'raw-output'),
      },
      { label: 'Final output', hint: 'cropped result', key: finalKey },
    ];
    const storage = getStorage();
    stages = await Promise.all(
      candidates.map(async (c) => ({
        ...c,
        present: c.key ? await storage.has(c.key).catch(() => false) : false,
      })),
    );
  }

  return (
    <div>
      <div className="mb-8 flex items-baseline gap-4">
        <h1 className="m-0 text-3xl font-light tracking-tight text-stone-900">Stylize history</h1>
        <span className="text-sm text-stone-500">per-tile pipeline trace</span>
      </div>
      <p className="mb-8 max-w-[640px] text-[13px] leading-relaxed text-stone-500">
        Pick a project, then a tile, to see every stage the stylizer ran it through — raw render,
        the composite fed to the model, the model's raw output, and the final cropped tile.
      </p>

      <Picker
        label="Project"
        items={projects.map((p) => ({
          id: p.id,
          name: p.name,
          href: `/admin/stylize?project=${p.id}`,
          active: p.id === project?.id,
        }))}
        empty="No projects yet."
      />

      {project && <TileGrid projectId={project.id} tiles={tiles} selected={coords} />}

      {project && tile && (
        <section className="mt-10">
          <div className="mb-4 flex items-baseline gap-3">
            <h2 className="m-0 text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500">
              Tile {tile.x},{tile.y}
            </h2>
            <span className="text-xs text-stone-400">
              {tile.currentStatusType}/{tile.status}
              {tile.retryAttempt > 0 ? ` · retry ${tile.retryAttempt}` : ''} · {tile.lat.toFixed(5)}
              , {tile.lng.toFixed(5)}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {stages.map((s, i) => (
              <StageCard key={s.label} stage={s} step={i + 1} />
            ))}
          </div>
        </section>
      )}

      {project && !tile && tiles.length > 0 && (
        <p className="mt-8 text-[13px] text-stone-500">Select a tile above to trace its history.</p>
      )}
    </div>
  );
}

function Picker({
  label,
  items,
  empty,
}: {
  label: string;
  items: { id: string; name: string; href: string; active: boolean }[];
  empty: string;
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500">
        {label}
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-stone-400">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((it) => (
            <Link
              key={it.id}
              href={it.href}
              className={`rounded-full border px-4 py-1.5 text-xs no-underline transition ${
                it.active
                  ? 'border-stone-900 bg-stone-900 text-white'
                  : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
              }`}
            >
              {it.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact clickable grid of a project's tiles, colour-coded by status. */
function TileGrid({
  projectId,
  tiles,
  selected,
}: {
  projectId: string;
  tiles: Awaited<ReturnType<typeof repos.tilesByProject>>;
  selected: { x: number; y: number } | null;
}) {
  if (tiles.length === 0) {
    return <p className="text-[13px] text-stone-400">This project has no tiles.</p>;
  }
  const xs = tiles.map((t) => t.x);
  const ys = tiles.map((t) => t.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const byCell = new Map(tiles.map((t) => [`${t.x}_${t.y}`, t]));

  const rows: number[] = [];
  for (let y = maxY; y >= minY; y--) rows.push(y);
  const cols: number[] = [];
  for (let x = minX; x <= maxX; x++) cols.push(x);

  return (
    <div className="mb-2">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500">
        Tiles
      </div>
      <div className="inline-flex flex-col gap-1 overflow-auto">
        {rows.map((y) => (
          <div key={y} className="flex gap-1">
            {cols.map((x) => {
              const t = byCell.get(`${x}_${y}`);
              if (!t) {
                return <span key={x} className="h-7 w-7 rounded-md bg-stone-100/50" />;
              }
              const isSel = selected?.x === x && selected?.y === y;
              return (
                <Link
                  key={x}
                  href={`/admin/stylize?project=${projectId}&tile=${x}_${y}`}
                  title={`${x},${y} — ${t.currentStatusType}/${t.status}`}
                  className={`flex h-7 w-7 items-center justify-center rounded-md text-[9px] no-underline transition ${statusClass(
                    t.currentStatusType,
                    t.status,
                  )} ${isSel ? 'ring-2 ring-stone-900 ring-offset-1' : ''}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <Legend />
    </div>
  );
}

function statusClass(phase: string, status: string): string {
  if (status === 'error') return 'bg-red-400 text-white hover:bg-red-500';
  if (phase === 'stylize' && status === 'done')
    return 'bg-emerald-500 text-white hover:bg-emerald-600';
  if (phase === 'stylize') return 'bg-amber-300 hover:bg-amber-400';
  if (status === 'done') return 'bg-sky-300 hover:bg-sky-400';
  return 'bg-stone-200 hover:bg-stone-300';
}

function Legend() {
  const items: [string, string][] = [
    ['bg-stone-200', 'render pending'],
    ['bg-sky-300', 'rendered'],
    ['bg-amber-300', 'stylizing'],
    ['bg-emerald-500', 'stylized'],
    ['bg-red-400', 'error'],
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-4">
      {items.map(([c, label]) => (
        <span key={label} className="flex items-center gap-1.5 text-[11px] text-stone-500">
          <span className={`h-3 w-3 rounded ${c}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

function StageCard({ stage, step }: { stage: Stage; step: number }) {
  return (
    <div className="flex flex-col rounded-2xl border border-stone-200/70 bg-white p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[13px] text-stone-700">
          <span className="text-stone-400">{step}.</span> {stage.label}
        </span>
        <span className="text-[11px] text-stone-400">{stage.hint}</span>
      </div>
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-stone-100 bg-stone-50">
        {stage.present && stage.key ? (
          <img
            src={blobUrl(stage.key)}
            alt={stage.label}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="px-3 text-center text-[11px] text-stone-400">
            {stage.key ? 'not in storage yet' : 'not produced'}
          </span>
        )}
      </div>
      {stage.key && (
        <code className="mt-2 block truncate text-[10px] text-stone-400" title={stage.key}>
          {stage.key}
        </code>
      )}
    </div>
  );
}
