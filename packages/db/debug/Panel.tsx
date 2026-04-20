import type { TableCounts } from '../src/repos/stats';
import type { Model } from '../src/schema/models';
import type { Project } from '../src/schema/projects';
import { CreateProjectForm, DeleteProjectButton } from './ClientBits';

export interface DbPanelProps {
  postgresVersion: string;
  postgisVersion: string | null;
  counts: TableCounts;
  projects: Project[];
  models: Model[];
  createProjectAction: (
    fd: FormData,
  ) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  deleteProjectAction: (id: string) => Promise<void>;
  seedAction: () => Promise<void>;
}

export function DbPanel({
  postgresVersion,
  postgisVersion,
  counts,
  projects,
  models,
  createProjectAction,
  deleteProjectAction,
  seedAction,
}: DbPanelProps) {
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section style={card}>
        <h2 style={h2}>connection</h2>
        <dl style={dlStyle}>
          <dt style={dtStyle}>postgres</dt>
          <dd style={ddStyle}>{shortVersion(postgresVersion)}</dd>
          <dt style={dtStyle}>postgis</dt>
          <dd style={ddStyle}>{postgisVersion ?? '(not installed)'}</dd>
        </dl>
      </section>

      <section style={card}>
        <h2 style={h2}>row counts</h2>
        <table style={tableStyle}>
          <tbody>
            {Object.entries(counts).map(([k, v]) => (
              <tr key={k}>
                <td style={tdStyle}>
                  <code>{k}</code>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={h2}>models</h2>
          <form action={seedAction}>
            <button type="submit" style={btnStyle}>
              seed defaults
            </button>
          </form>
        </div>
        {models.length === 0 ? (
          <div style={{ opacity: 0.6, fontSize: 13 }}>(none — press "seed defaults")</div>
        ) : (
          <table style={tableStyle}>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td style={tdStyle}>{m.active ? '★' : ''}</td>
                  <td style={tdStyle}>
                    <code>{m.id}</code>
                  </td>
                  <td style={{ ...tdStyle, opacity: 0.7 }}>{m.kind}</td>
                  <td style={{ ...tdStyle, opacity: 0.7, fontFamily: 'monospace', fontSize: 12 }}>
                    {m.endpoint}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>projects</h2>
        <CreateProjectForm action={createProjectAction} />
        <div style={{ height: 16 }} />
        {projects.length === 0 ? (
          <div style={{ opacity: 0.6, fontSize: 13 }}>(no projects)</div>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>name</th>
                <th style={thStyle}>slug</th>
                <th style={thStyle}>status</th>
                <th style={thStyle}>camera</th>
                <th style={thStyle}>center</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td style={tdStyle}>{p.name}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{p.slug}</td>
                  <td style={tdStyle}>{p.status}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>
                    p={p.cameraPitch}° y={p.cameraYaw}°
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>
                    {p.centerLat.toFixed(4)}, {p.centerLng.toFixed(4)}
                  </td>
                  <td style={tdStyle}>
                    <DeleteProjectButton id={p.id} slug={p.slug} action={deleteProjectAction} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function shortVersion(v: string): string {
  return v.split(' ').slice(0, 2).join(' ');
}

const card = {
  background: '#fff',
  border: '1px solid #e5e5e5',
  borderRadius: 8,
  padding: 20,
};
const h2 = {
  fontSize: 14,
  margin: 0,
  marginBottom: 12,
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
  opacity: 0.6,
};
const dlStyle = {
  display: 'grid',
  gridTemplateColumns: '120px 1fr',
  gap: '4px 12px',
  fontSize: 13,
  margin: 0,
};
const dtStyle = { fontFamily: 'monospace' as const, opacity: 0.7 };
const ddStyle = { margin: 0, fontFamily: 'monospace' as const };
const tableStyle = { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 };
const thStyle = {
  textAlign: 'left' as const,
  padding: '6px 10px',
  borderBottom: '1px solid #e5e5e5',
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
  opacity: 0.5,
};
const tdStyle = { padding: '8px 10px', borderBottom: '1px solid #f3f4f6' };
const btnStyle = {
  fontSize: 12,
  padding: '4px 10px',
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
};
