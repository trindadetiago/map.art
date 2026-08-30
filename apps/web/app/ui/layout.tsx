import Link from 'next/link';
import type { ReactNode } from 'react';
import { CATEGORIES } from './_components/catalog';
import { UiNav } from './_components/ui_nav';

export default function UiLayout({ children }: { children: ReactNode }) {
  const items = CATEGORIES.map((c) => ({ slug: c.slug, title: c.title }));

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1280px] items-center justify-between px-8 py-6">
        <Link
          href="/ui"
          className="text-[15px] font-medium tracking-tight text-stone-900 no-underline"
        >
          earthToPixels <span className="text-stone-400">· components</span>
        </Link>
        <Link
          href="/"
          className="rounded-full border border-stone-200 bg-white px-4 py-1.5 text-xs text-stone-700 no-underline transition hover:border-stone-300"
        >
          home ↗
        </Link>
      </header>
      <div className="mx-auto flex max-w-[1280px] gap-10 px-8 pb-16">
        <aside className="hidden w-44 shrink-0 md:block">
          <div className="sticky top-6">
            <UiNav items={items} />
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
