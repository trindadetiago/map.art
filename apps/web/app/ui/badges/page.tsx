import { Badge, PageHeader, Spec } from '../_components/spec';

export default function BadgesPage() {
  return (
    <div>
      <PageHeader title="Badges" description="Status pills and neutral count badges." />
      <Spec name="Variants">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">active</Badge>
          <Badge className="border-amber-200 bg-amber-50 text-amber-700">setup</Badge>
          <Badge className="border-stone-200 bg-stone-100 text-stone-500">archived</Badge>
          <Badge className="border-stone-200 bg-stone-50 text-stone-600">neutral / s3</Badge>
        </div>
      </Spec>
    </div>
  );
}
