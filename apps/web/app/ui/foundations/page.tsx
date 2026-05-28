import { STONE_SCALE } from '../_components/catalog';
import { PageHeader, Spec } from '../_components/spec';

export default function FoundationsPage() {
  return (
    <div>
      <PageHeader
        title="Foundations"
        description="Palette and type scale — the stone tokens every surface is built on."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Spec name="Stone scale">
          <div className="flex flex-wrap gap-2">
            {STONE_SCALE.map(([n, cls]) => (
              <div key={n} className="flex flex-col items-center gap-1">
                <div className={`h-12 w-12 rounded-lg border border-stone-200/70 ${cls}`} />
                <span className="font-mono text-[10px] text-stone-400">{n}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-3 text-[11px] text-stone-500">
            <span className="rounded bg-[#f3f1ec] px-2 py-1 ring-1 ring-stone-200">
              page #f3f1ec
            </span>
            <span className="rounded bg-white px-2 py-1 text-[#14110d] ring-1 ring-stone-200">
              ink #14110d
            </span>
          </div>
        </Spec>
        <Spec name="Type scale">
          <div className="flex flex-col gap-2">
            <div className="text-[44px] font-light leading-none tracking-tight text-stone-900">
              44 / metric
            </div>
            <div className="text-[17px] font-medium tracking-tight text-stone-900">
              17 / card title
            </div>
            <div className="text-[13px] text-stone-700">13 / body</div>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500">
              11 / section label
            </div>
          </div>
        </Spec>
      </div>
    </div>
  );
}
