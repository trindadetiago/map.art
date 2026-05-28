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
    </div>
  );
}
