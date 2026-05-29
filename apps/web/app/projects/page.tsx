import { repos } from '@mapart/db';

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
            Create one from the CLI: <code>pnpm mapart db projects create --name "..."</code>
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
              <div style={{ fontWeight: 600, fontSize: 16, color: '#111' }}>{p.name}</div>
              {p.description && (
                <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>{p.description}</div>
              )}
              <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>{counts[i]} tiles</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
