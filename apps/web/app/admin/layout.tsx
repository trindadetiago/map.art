import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1280px] items-center justify-between px-8 py-6">
        <Link
          href="/admin"
          className="text-[15px] font-medium tracking-tight text-stone-900 no-underline"
        >
          earthToPixels <span className="text-stone-400">· admin</span>
        </Link>
        <Link
          href="/"
          className="rounded-full border border-stone-200 bg-white px-4 py-1.5 text-xs text-stone-700 no-underline transition hover:border-stone-300"
        >
          home ↗
        </Link>
      </header>
      <main className="mx-auto max-w-[1280px] px-8 pb-16">{children}</main>
    </div>
  );
}
