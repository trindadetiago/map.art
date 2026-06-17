'use client';

export type StepId = 1 | 2 | 3 | 4 | 5;

interface StepDef {
  id: StepId;
  title: string;
  hint: string;
}

const STEPS: StepDef[] = [
  { id: 1, title: 'City', hint: 'search a location' },
  { id: 2, title: 'Area', hint: 'frame the grid' },
  { id: 3, title: 'Build', hint: 'watch it render' },
  { id: 4, title: 'Review', hint: 'edit & post-process' },
  { id: 5, title: 'Pins', hint: 'label the map' },
];

export function StepRail({
  active,
  onSelect,
  canArea,
  canBuild,
  canReview,
  canPins,
}: {
  active: StepId;
  onSelect: (id: StepId) => void;
  canArea: boolean;
  canBuild: boolean;
  canReview: boolean;
  canPins: boolean;
}) {
  const enabled = (id: StepId): boolean => {
    if (id === 2) return canArea;
    if (id === 3) return canBuild;
    if (id === 4) return canReview;
    if (id === 5) return canPins;
    return true;
  };

  return (
    <nav className="flex w-56 shrink-0 flex-col gap-3">
      {STEPS.map((s) => {
        const isActive = s.id === active;
        const on = enabled(s.id);
        return (
          <button
            key={s.id}
            type="button"
            disabled={!on}
            onClick={() => on && onSelect(s.id)}
            className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition ${
              isActive
                ? 'border-stone-900 bg-stone-900 text-white shadow-sm'
                : on
                  ? 'border-stone-200 bg-white text-stone-800 hover:border-stone-400'
                  : 'cursor-not-allowed border-stone-100 bg-stone-50 text-stone-300'
            }`}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${
                isActive
                  ? 'bg-white text-stone-900'
                  : on
                    ? 'bg-stone-100 text-stone-600'
                    : 'bg-stone-100 text-stone-300'
              }`}
            >
              {s.id}
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-medium">{s.title}</span>
              <span
                className={`block text-[12px] ${isActive ? 'text-stone-300' : 'text-stone-400'}`}
              >
                {s.hint}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
