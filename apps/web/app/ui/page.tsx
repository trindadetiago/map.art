import { IconArrowUpRight } from '@/components/admin/icons';
import Link from 'next/link';
import { CATEGORIES } from './_components/catalog';

export default function UiGallery() {
  return (
    <div>
      <div className="mb-10">
        <h1 className="m-0 text-[28px] font-light tracking-tight text-stone-900">Components</h1>
        <p className="mt-2 mb-0 max-w-[60ch] text-[14px] leading-snug text-stone-500">
          The stone design system the admin and project surfaces are built from. One of each here —
          open a category for every variation.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map((c) => (
          <Link key={c.slug} href={`/ui/${c.slug}`} className="group flex flex-col no-underline">
            <div className="pointer-events-none flex h-44 select-none items-center justify-center rounded-xl border border-stone-200/70 bg-[#faf9f6] px-6">
              <c.Preview />
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-[15px] font-medium tracking-tight text-stone-900">
                {c.title}
              </span>
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 transition group-hover:border-stone-400 group-hover:text-stone-900">
                <IconArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="mt-1 mb-0 text-[13px] leading-snug text-stone-500">{c.blurb}</p>
            <p className="mt-2 mb-0 font-mono text-[10px] text-stone-400">{c.source}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
