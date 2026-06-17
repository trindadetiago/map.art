'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';

const Globe = dynamic(() => import('@mapart/ui/globe/react').then((m) => m.Globe), {
  ssr: false,
  loading: () => (
    <div className="mx-auto aspect-square w-full max-w-[220px] animate-pulse rounded-full bg-neutral-200/50" />
  ),
});

export function GlobeCard() {
  return (
    <div className="relative w-full max-w-[360px] rounded-3xl border border-neutral-200/70 bg-white p-5">
      <div className="mx-auto aspect-square w-full max-w-[220px]">
        <Globe variant="pixelated" pixelSize={7} rotateSpeed={0.5} className="h-full w-full" />
      </div>
      <div className="mt-12 flex gap-2">
        <Link
          href="/projects"
          className="inline-flex h-9 flex-1 items-center justify-center rounded-full bg-[#3f8f5a] text-[12px] font-medium text-white no-underline transition hover:bg-[#37804f]"
        >
          Create map
        </Link>
        <Link
          href="/projects"
          className="inline-flex h-9 flex-1 items-center justify-center rounded-full border border-neutral-200 text-[12px] font-medium text-neutral-700 no-underline transition hover:bg-neutral-50"
        >
          See all maps
        </Link>
      </div>
    </div>
  );
}
