import type { ReactNode } from 'react';

export function Section({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-12">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="m-0 text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500">
          {label}
        </h2>
        {description && <span className="text-xs text-stone-400">{description}</span>}
      </div>
      {children}
    </section>
  );
}
