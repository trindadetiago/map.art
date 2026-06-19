'use client';

import { useState, useTransition } from 'react';

export type UpdateResult = { ok: true } | { ok: false; error: string };

const FIELD_LABEL = 'text-[11px] uppercase tracking-[0.12em] text-stone-500 font-medium';
const INPUT =
  'h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-[13px] outline-none transition focus:border-stone-400';

export function EditProjectForm({
  id,
  name,
  year,
  description,
  action,
}: {
  id: string;
  name: string;
  year: number | null;
  description: string | null;
  action: (id: string, fd: FormData) => Promise<UpdateResult>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="text-[11px] text-stone-400 underline-offset-4 transition hover:text-stone-700 hover:underline"
      >
        edit
      </button>
    );
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col gap-2.5 rounded-2xl border border-stone-300 bg-white p-5 shadow-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setError(null);
          const fd = new FormData(e.currentTarget);
          startTransition(async () => {
            const res = await action(id, fd);
            if (res.ok) setOpen(false);
            else setError(res.error);
          });
        }}
        className="flex flex-col gap-2.5"
      >
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>name</span>
          <input name="name" defaultValue={name} required className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>year</span>
          <input
            name="year"
            type="number"
            inputMode="numeric"
            defaultValue={year ?? ''}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>description</span>
          <textarea
            name="description"
            defaultValue={description ?? ''}
            rows={2}
            className="w-full resize-none rounded-lg border border-stone-200 bg-white px-3 py-2 text-[13px] outline-none transition focus:border-stone-400"
          />
        </label>
        {error && <p className="m-0 text-[12px] text-red-600">{error}</p>}
        <div className="mt-1 flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="h-8 rounded-full bg-stone-900 px-4 text-[12px] text-white transition hover:bg-stone-700 disabled:opacity-50"
          >
            {pending ? 'saving…' : 'save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            className="h-8 rounded-full border border-stone-200 px-4 text-[12px] text-stone-700 transition hover:border-stone-300"
          >
            cancel
          </button>
        </div>
      </form>
    </div>
  );
}
