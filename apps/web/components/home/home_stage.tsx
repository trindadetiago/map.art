import { GlobeCard } from '@/components/home/globe_card';
import { MapBackdrop } from '@/components/home/map_backdrop';
import Link from 'next/link';

export function HomeStage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-8">
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-8 py-6">
        <span className="text-[14px] font-medium tracking-tight text-neutral-900">map.art</span>
        <nav className="flex items-center gap-1">
          <Link
            href="/ui"
            className="rounded-full px-3.5 py-1.5 text-[13px] text-neutral-500 no-underline transition hover:text-neutral-900"
          >
            /ui
          </Link>
          <Link
            href="/admin"
            className="rounded-full px-3.5 py-1.5 text-[13px] text-neutral-500 no-underline transition hover:text-neutral-900"
          >
            /admin
          </Link>
        </nav>
      </header>
      <MapBackdrop />
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[560px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(33,73,107,0.16), rgba(99,176,109,0.08) 42%, transparent 66%)',
        }}
      />
      <GlobeCard />
    </main>
  );
}
