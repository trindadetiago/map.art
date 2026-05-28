'use client';

export function Field({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
        {label}
      </span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
        className="h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-[13px] text-stone-900 outline-none transition focus:border-stone-400"
      />
    </label>
  );
}
