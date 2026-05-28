import { PageHeader, Spec } from '../_components/spec';

export default function ButtonsPage() {
  return (
    <div>
      <PageHeader title="Buttons" description="Recurring pill button patterns." />
      <Spec name="Variants">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="h-9 rounded-full bg-stone-900 px-5 text-[13px] text-white transition hover:bg-stone-700 disabled:opacity-50"
          >
            primary
          </button>
          <button
            type="button"
            disabled
            className="h-9 rounded-full bg-stone-900 px-5 text-[13px] text-white transition hover:bg-stone-700 disabled:opacity-50"
          >
            disabled
          </button>
          <button
            type="button"
            className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] text-stone-700 transition hover:border-stone-400"
          >
            secondary
          </button>
          <button
            type="button"
            className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-700 transition hover:border-red-400 hover:bg-red-100"
          >
            danger
          </button>
          <button
            type="button"
            className="text-[11px] text-stone-400 underline-offset-4 transition hover:text-red-600 hover:underline"
          >
            text · delete
          </button>
        </div>
      </Spec>
    </div>
  );
}
