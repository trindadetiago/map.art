import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV = [
  { slug: '', label: 'index' },
  { slug: 'env', label: 'env' },
  { slug: 'renderer', label: 'renderer' },
  { slug: 'models', label: 'models' },
  { slug: 'storage', label: 'storage' },
  { slug: 'db', label: 'db' },
  { slug: 'tiles', label: 'tiles' },
  { slug: 'pipeline', label: 'pipeline' },
] as const;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-[220px_1fr]">
      <aside className="border-r border-neutral-200 bg-white p-6 text-sm">
        <Link href="/" className="text-neutral-500 no-underline hover:text-neutral-700">
          ← home
        </Link>
        <h2 className="mt-6 mb-2 text-sm uppercase tracking-[1px] text-neutral-500">admin</h2>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {NAV.map((n) => (
            <li key={n.slug || 'index'}>
              <Link href={`/admin${n.slug ? `/${n.slug}` : ''}`}>{n.label}</Link>
            </li>
          ))}
        </ul>
      </aside>
      <main className="p-8">{children}</main>
    </div>
  );
}
