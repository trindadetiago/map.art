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

export default function DebugIndex() {
  return (
    <div>
      <h1 style={{ marginTop: 0 }}>debug</h1>
      <p style={{ opacity: 0.7, maxWidth: 640 }}>
        One panel per package. Use these to exercise individual modules in isolation.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12, maxWidth: 640 }}>
        {tools.map((t) => (
          <li
            key={t.slug}
            style={{
              padding: 16,
              background: '#fff',
              border: '1px solid #e5e5e5',
              borderRadius: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Link href={`/admin/${t.slug}`} style={{ fontWeight: 600, fontSize: 16 }}>
                {t.title}
              </Link>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background:
                    t.status === 'ready' ? '#d1fae5' : t.status === 'wip' ? '#fef3c7' : '#e5e7eb',
                  color: '#374151',
                }}
              >
                {t.status}
              </span>
            </div>
            <p style={{ opacity: 0.7, margin: '4px 0 0', fontSize: 14 }}>{t.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
