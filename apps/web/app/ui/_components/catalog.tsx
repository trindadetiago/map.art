import { Card } from '@/components/admin/card';
import {
  IconArrowUpRight,
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconDatabase,
  IconEnv,
  IconGrid,
  IconLayers,
  IconMap,
  IconSparkles,
  IconStorage,
  IconWorkflow,
} from '@/components/admin/icons';
import type { ReactNode, SVGProps } from 'react';

export const STONE_SCALE: [string, string][] = [
  ['50', 'bg-stone-50'],
  ['100', 'bg-stone-100'],
  ['200', 'bg-stone-200'],
  ['300', 'bg-stone-300'],
  ['400', 'bg-stone-400'],
  ['500', 'bg-stone-500'],
  ['700', 'bg-stone-700'],
  ['900', 'bg-stone-900'],
];

export const ICONS: [string, (p: SVGProps<SVGSVGElement>) => ReactNode][] = [
  ['IconLayers', IconLayers],
  ['IconDatabase', IconDatabase],
  ['IconStorage', IconStorage],
  ['IconEnv', IconEnv],
  ['IconGrid', IconGrid],
  ['IconSparkles', IconSparkles],
  ['IconCamera', IconCamera],
  ['IconWorkflow', IconWorkflow],
  ['IconArrowUpRight', IconArrowUpRight],
  ['IconChevronDown', IconChevronDown],
  ['IconCheck', IconCheck],
  ['IconMap', IconMap],
];

export type Category = {
  slug: string;
  title: string;
  blurb: string;
  source: string;
  Preview: () => ReactNode;
};

export const CATEGORIES: Category[] = [
  {
    slug: 'foundations',
    title: 'Foundations',
    blurb: 'Palette and type scale — the stone tokens every surface is built on.',
    source: 'tailwind stone · page #f3f1ec · ink #14110d',
    Preview: () => (
      <div className="flex gap-1.5">
        {['bg-stone-100', 'bg-stone-300', 'bg-stone-500', 'bg-stone-700', 'bg-stone-900'].map(
          (c) => (
            <div key={c} className={`h-10 w-10 rounded-lg border border-stone-200/70 ${c}`} />
          ),
        )}
      </div>
    ),
  },
  {
    slug: 'icons',
    title: 'Icons',
    blurb: 'Line icons at 1.6 stroke, inheriting currentColor.',
    source: '@/components/admin/icons',
    Preview: () => (
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-stone-900 text-white">
        <IconSparkles className="h-6 w-6" />
      </span>
    ),
  },
  {
    slug: 'cards',
    title: 'Cards',
    blurb: 'The card shell: icon disc, optional badge and link, metric body.',
    source: '@/components/admin/card',
    Preview: () => <Card icon={IconLayers} label="Plain card" className="w-full max-w-[240px]" />,
  },
  {
    slug: 'buttons',
    title: 'Buttons',
    blurb: 'Pill button variants — primary, secondary, danger, and text.',
    source: 'recurring pill patterns',
    Preview: () => (
      <button type="button" className="h-9 rounded-full bg-stone-900 px-5 text-[13px] text-white">
        primary
      </button>
    ),
  },
  {
    slug: 'forms',
    title: 'Form controls',
    blurb: 'Text inputs, number fields, and the Radix-backed Select.',
    source: '@/components/admin/select',
    Preview: () => (
      <input
        placeholder="my project"
        readOnly
        className="h-9 w-full max-w-[240px] rounded-lg border border-stone-200 bg-white px-3 text-[13px] text-stone-900 outline-none"
      />
    ),
  },
  {
    slug: 'badges',
    title: 'Badges',
    blurb: 'Status pills and neutral count badges.',
    source: 'status pills + count badges',
    Preview: () => (
      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] text-emerald-700">
        active
      </span>
    ),
  },
  {
    slug: 'composite',
    title: 'Composite',
    blurb: 'ProjectCard — a real composition of the primitives.',
    source: '@/components/admin/projects',
    Preview: () => (
      <div className="w-full max-w-[240px] rounded-2xl border border-stone-200/70 bg-white p-5">
        <div className="flex items-start justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-900 text-white">
            <IconLayers className="h-4 w-4" />
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] text-emerald-700">
            active
          </span>
        </div>
        <div className="mt-4 text-[15px] font-medium tracking-tight text-stone-900">
          João Pessoa centro
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-stone-500">joao-pessoa</div>
      </div>
    ),
  },
];
