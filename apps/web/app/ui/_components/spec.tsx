import type { ReactNode } from 'react';

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-10">
      <h1 className="m-0 text-[28px] font-light tracking-tight text-stone-900">{title}</h1>
      {description && (
        <p className="mt-2 mb-0 max-w-[60ch] text-[14px] leading-snug text-stone-500">
          {description}
        </p>
      )}
    </div>
  );
}

export function Spec({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-stone-200/70 bg-white p-6">
      <div className="mb-4 font-mono text-[11px] text-stone-400">{name}</div>
      {children}
    </div>
  );
}

export function Badge({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`rounded-full border px-3 py-1 text-[11px] capitalize ${className}`}>
      {children}
    </span>
  );
}
