import Link from 'next/link';

const tools: {
  slug: string;
  title: string;
  description: string;
  status: 'stub' | 'wip' | 'ready';
}[] = [
  {
    slug: 'env',
    title: 'env',
    description: 'Status of environment variables (set / unset / default). Values never shown.',
    status: 'ready',
  },
  {
    slug: 'renderer',
    title: 'renderer',
    description:
      'Live Three.js scene streaming Google Photorealistic 3D Tiles. Tune params, capture canvas to PNG.',
    status: 'ready',
  },
  {
    slug: 'models',
    title: 'models',
    description:
      'Run an input PNG through a model (stub or nano-banana) with a prompt. Use "latest capture" to chain from the renderer.',
    status: 'ready',
  },
  {
    slug: 'storage',
    title: 'storage',
    description:
      'Browse persisted PNGs written by the renderer/models panels. Preview, delete, find by prefix.',
    status: 'ready',
  },
  {
    slug: 'db',
    title: 'db',
    description:
      'Postgres+PostGIS status, row counts, model registry, and projects CRUD. First DB-backed screen.',
    status: 'ready',
  },
  {
    slug: 'tiles',
    title: 'tiles',
    description:
      'Web-mercator tile math. Visualize which (x, y) tiles cover a bbox or circle at a given zoom.',
    status: 'ready',
  },
  {
    slug: 'pipeline',
    title: 'pipeline',
    description:
      'Generation-strategy research. Phase 1 renders N tiles; Phase 2 runs a strategy over them and stitches.',
    status: 'wip',
  },
];

const STATUS_CLASS: Record<(typeof tools)[number]['status'], string> = {
  ready: 'bg-emerald-100 text-neutral-700',
  wip: 'bg-amber-100 text-neutral-700',
  stub: 'bg-neutral-200 text-neutral-700',
};

export default function DebugIndex() {
  return (
    <div>
      <h1 className="mt-0">debug</h1>
      <p className="max-w-[640px] opacity-70">
        One panel per package. Use these to exercise individual modules in isolation.
      </p>
      <ul className="grid max-w-[640px] list-none gap-3 p-0">
        {tools.map((t) => (
          <li key={t.slug} className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <Link href={`/admin/${t.slug}`} className="text-base font-semibold">
                {t.title}
              </Link>
              <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_CLASS[t.status]}`}>
                {t.status}
              </span>
            </div>
            <p className="mt-1 mb-0 text-sm opacity-70">{t.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
