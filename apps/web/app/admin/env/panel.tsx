import { getEnvStatus } from '@mapart/env';

const STATUS_CLASS = {
  set: 'bg-emerald-100 text-emerald-700',
  default: 'bg-amber-100 text-amber-700',
  unset: 'bg-neutral-200 text-neutral-500',
} as const;

export function EnvPanel() {
  const entries = getEnvStatus();
  return (
    <div>
      <p className="max-w-[640px] opacity-70">
        Status of environment variables defined in <code>@mapart/env</code>. Values are never shown
        — only whether each one is set.
      </p>
      <table className="w-full max-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="text-left">
            <th className="border-b border-neutral-200 px-2.5 py-1.5 text-xs uppercase tracking-[1px] opacity-60">
              env var
            </th>
            <th className="border-b border-neutral-200 px-2.5 py-1.5 text-xs uppercase tracking-[1px] opacity-60">
              status
            </th>
            <th className="border-b border-neutral-200 px-2.5 py-1.5 text-xs uppercase tracking-[1px] opacity-60">
              description
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const label: keyof typeof STATUS_CLASS = e.isSet
              ? e.usingDefault
                ? 'default'
                : 'set'
              : 'unset';
            return (
              <tr key={e.key}>
                <td className="border-b border-neutral-100 px-2.5 py-2">
                  <code>{e.envKey}</code>
                </td>
                <td className="border-b border-neutral-100 px-2.5 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${STATUS_CLASS[label]}`}
                  >
                    {label}
                  </span>
                </td>
                <td className="border-b border-neutral-100 px-2.5 py-2 opacity-75">
                  {e.description}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
