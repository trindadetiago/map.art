import { getEnvStatus } from '@mapart/env';

export function EnvPanel() {
  const entries = getEnvStatus();
  return (
    <div>
      <p style={{ opacity: 0.7, maxWidth: 640 }}>
        Status of environment variables defined in <code>@mapart/env</code>. Values are never shown
        — only whether each one is set.
      </p>
      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 720, fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th style={thStyle}>env var</th>
            <th style={thStyle}>status</th>
            <th style={thStyle}>description</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const label = e.isSet ? (e.usingDefault ? 'default' : 'set') : 'unset';
            const color = e.usingDefault ? '#ca8a04' : e.isSet ? '#16a34a' : '#9ca3af';
            return (
              <tr key={e.key}>
                <td style={tdStyle}>
                  <code>{e.envKey}</code>
                </td>
                <td style={tdStyle}>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: `${color}22`,
                      color,
                      fontFamily: 'monospace',
                    }}
                  >
                    {label}
                  </span>
                </td>
                <td style={{ ...tdStyle, opacity: 0.75 }}>{e.description}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle = {
  padding: '6px 10px',
  borderBottom: '1px solid #e5e5e5',
  fontSize: 12,
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
  opacity: 0.6,
};
const tdStyle = { padding: '8px 10px', borderBottom: '1px solid #f3f4f6' };
