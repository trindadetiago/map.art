import { repos } from '@mapart/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ProjectsListPage() {
  const projects = await repos.listProjects();
  const counts = await Promise.all(projects.map((p) => repos.countTilesForProject(p.id)));

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>projects</h1>
      {projects.length === 0 ? (
        <div style={{ opacity: 0.6 }}>
          <p>No projects yet.</p>
          <p style={{ fontSize: 13 }}>
            Create one from the CLI for now:
            <br />
            <code>
              pnpm -w run db projects create-with-circle --name "..." --slug "..." --lat -7.115
              --lng -34.861 --radius 800 --zoom 18
            </code>
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12, maxWidth: 720 }}>
          {projects.map((p, i) => (
            <li
              key={p.id}
              style={{
                background: '#fff',
                border: '1px solid #e5e5e5',
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <Link
                  href={`/projects/${p.slug}`}
                  style={{ fontWeight: 600, fontSize: 16, color: '#111', textDecoration: 'none' }}
                >
                  {p.name}
                </Link>
                <span style={{ fontSize: 12, opacity: 0.6, fontFamily: 'monospace' }}>
                  {p.slug}
                </span>
              </div>
              <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
                {counts[i]} tiles · {p.tileWorldMeters}m/{p.tilePixelSize}px · pitch {p.cameraPitch}
                ° yaw {p.cameraYaw}° · <span style={statusStyle(p.status)}>{p.status}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function statusStyle(s: string) {
  const color = s === 'active' ? '#16a34a' : s === 'archived' ? '#6b7280' : '#ca8a04';
  return {
    display: 'inline-block',
    padding: '0 6px',
    borderRadius: 3,
    background: `${color}22`,
    color,
    fontFamily: 'monospace' as const,
    fontSize: 11,
  };
}
