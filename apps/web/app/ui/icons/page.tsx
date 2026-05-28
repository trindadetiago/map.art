import { ICONS } from '../_components/catalog';
import { PageHeader } from '../_components/spec';

export default function IconsPage() {
  return (
    <div>
      <PageHeader
        title="Icons"
        description="@/components/admin/icons · 1.6 stroke, currentColor."
      />
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {ICONS.map(([name, Icon]) => (
          <div
            key={name}
            className="flex flex-col items-center gap-2 rounded-xl border border-stone-200/70 bg-white p-4"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-900 text-white">
              <Icon className="h-5 w-5" />
            </span>
            <span className="font-mono text-[10px] text-stone-500">{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
