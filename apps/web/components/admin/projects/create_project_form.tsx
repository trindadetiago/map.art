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
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

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
            setName('');
            setSlug('');
            form.reset();
          } else {
            setError(result.error);
          }
        });
      }}
      className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr_1fr_auto] items-end gap-3"
    >
      <Field label="name">
        <input
          name="name"
          required
          value={name}
          onChange={(e) => {
            const v = e.target.value;
            setName(v);
            if (!slug || slug === slugify(name)) setSlug(slugify(v));
          }}
          className={INPUT}
        />
      </Field>
      <Field label="slug">
        <input
          name="slug"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className={`${INPUT} font-mono`}
        />
      </Field>
      <Field label="pitch°">
        <input name="pitch" type="number" defaultValue={30} step={1} className={INPUT} />
      </Field>
      <Field label="yaw°">
        <input name="yaw" type="number" defaultValue={45} step={1} className={INPUT} />
      </Field>
      <Field label="center lat">
        <input
          name="centerLat"
          type="number"
          defaultValue={-7.115}
          step={0.0001}
          className={INPUT}
        />
      </Field>
      <Field label="center lng">
        <input
          name="centerLng"
          type="number"
          defaultValue={-34.861}
          step={0.0001}
          className={INPUT}
        />
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
