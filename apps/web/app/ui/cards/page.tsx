import { Card, Metric } from '@/components/admin/card';
import {
  IconCamera,
  IconDatabase,
  IconGrid,
  IconLayers,
  IconSparkles,
  IconStorage,
  IconWorkflow,
} from '@/components/admin/icons';
import { StackedCard } from '@/components/admin/stacked_card';
import { PageHeader } from '../_components/spec';

export default function CardsPage() {
  return (
    <div>
      <PageHeader title="Cards" description="@/components/admin/card · Card + Metric." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card icon={IconLayers} label="Plain card" />
        <Card icon={IconStorage} label="With badge" badge="s3" />
        <Card icon={IconDatabase} label="Linked + badge" href="#" badge="live" />
        <Card icon={IconSparkles} label="With caption">
          <p className="mt-3 mb-0 max-w-[28ch] text-[13px] leading-snug text-stone-500">
            Free-form body content sits below the label.
          </p>
        </Card>
        <Card icon={IconGrid} label="Tile rows" className="sm:col-span-2">
          <Metric value="12,480" caption="seeded across all projects" />
        </Card>
        <Card icon={IconWorkflow} label="Jobs" href="#">
          <Metric value="0" caption="render / stylize queue" />
        </Card>
        <Card icon={IconCamera} label="Renderer" href="#" badge="wip">
          <Metric value="—" caption="not running" />
        </Card>
      </div>

      <section className="mt-12">
        <h2 className="m-0 text-[15px] font-medium tracking-tight text-stone-900">Stacked</h2>
        <p className="mb-6 mt-1 max-w-[60ch] text-[13px] leading-snug text-stone-500">
          @/components/admin/stacked_card · a flat outer frame wrapping a raised inner surface.
          Wraps any content.
        </p>
        <div className="flex justify-center py-2">
          <StackedCard>
            <div className="flex flex-col items-center text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 text-white">
                <IconLayers className="h-5 w-5" />
              </span>
              <div className="mt-3 text-[15px] font-medium tracking-tight text-neutral-900">
                Stacked card
              </div>
              <p className="mb-0 mt-1 max-w-[30ch] text-[13px] leading-snug text-neutral-500">
                A flat outer frame with a raised inner surface.
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                className="inline-flex h-11 w-full items-center justify-center rounded-full bg-neutral-900 text-[14px] text-white"
              >
                Primary
              </button>
              <button
                type="button"
                className="inline-flex h-11 w-full items-center justify-center rounded-full border border-neutral-200 bg-white text-[14px] text-neutral-700"
              >
                Secondary
              </button>
            </div>
          </StackedCard>
        </div>
      </section>
    </div>
  );
}
