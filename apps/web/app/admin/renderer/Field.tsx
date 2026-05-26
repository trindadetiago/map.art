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
    <label className="grid grid-cols-[140px_1fr] items-center gap-2">
      <span className="font-mono text-[13px]">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
        className="rounded border border-neutral-300 px-2 py-1.5 text-[13px]"
      />
    </label>
  );
}
