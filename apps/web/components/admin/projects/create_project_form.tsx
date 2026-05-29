'use client';

import { useState, useTransition } from 'react';

export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

const FIELD_LABEL = 'text-[11px] uppercase tracking-[0.12em] text-stone-500 font-medium';
const INPUT =
  'h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-[13px] outline-none transition focus:border-stone-400';
const BTN_PRIMARY =
  'h-9 rounded-full bg-stone-900 px-5 text-[13px] text-white transition hover:bg-stone-700 disabled:opacity-50';

export function CreateProjectForm({
  action,
}: {
  action: (fd: FormData) => Promise<CreateResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const form = e.currentTarget;
        const fd = new FormData(form);
        startTransition(async () => {
          const result = await action(fd);
          if (result.ok) {
            form.reset();
          } else {
            setError(result.error);
          }
        });
      }}
      className="grid grid-cols-[2fr_3fr_auto] items-end gap-3"
    >
      <Field label="name">
        <input name="name" required className={INPUT} />
      </Field>
      <Field label="description">
        <input name="description" className={INPUT} />
      </Field>
      <button type="submit" disabled={pending} className={BTN_PRIMARY}>
        {pending ? '…' : 'create'}
      </button>
      {error && (
        <pre className="col-span-full m-0 whitespace-pre-wrap text-xs text-red-600">{error}</pre>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: control is passed in as children
    <label className="flex flex-col gap-1.5">
      <span className={FIELD_LABEL}>{label}</span>
      {children}
    </label>
  );
}
