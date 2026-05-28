'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function UiNav({ items }: { items: { slug: string; title: string }[] }) {
  const pathname = usePathname();

  const link = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        className={`block rounded-lg px-3 py-1.5 text-[13px] no-underline transition ${
          active
            ? 'bg-stone-900 text-white'
            : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <nav className="flex flex-col gap-0.5">
      {link('/ui', 'Overview')}
      <div className="my-2 h-px bg-stone-200/70" />
      {items.map((it) => link(`/ui/${it.slug}`, it.title))}
    </nav>
  );
}
