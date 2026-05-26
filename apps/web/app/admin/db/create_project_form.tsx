'use client';

import { useState, useTransition } from 'react';

const INPUT = 'rounded border border-neutral-300 px-1.5 py-1 text-[13px]';
const BTN =
  'cursor-pointer rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs hover:bg-neutral-50';

export function CreateProjectForm({
  action,
}: {
  action: (fd: FormData) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
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
      className="grid grid-cols-[repeat(6,1fr)_auto] items-end gap-2 text-[13px]"
    >
      <Labeled label="name">
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
      </Labeled>
      <Labeled label="slug">
        <input
          name="slug"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className={INPUT}
        />
      </Labeled>
      <Labeled label="pitch">
        <input name="pitch" type="number" defaultValue={30} step={1} className={INPUT} />
      </Labeled>
      <Labeled label="yaw">
        <input name="yaw" type="number" defaultValue={45} step={1} className={INPUT} />
      </Labeled>
      <Labeled label="center lat">
        <input
          name="centerLat"
          type="number"
          defaultValue={-7.115}
          step={0.0001}
          className={INPUT}
        />
      </Labeled>
      <Labeled label="center lng">
        <input
          name="centerLng"
          type="number"
          defaultValue={-34.861}
          step={0.0001}
          className={INPUT}
        />
      </Labeled>
      <button type="submit" disabled={pending} className={BTN}>
        {pending ? '…' : 'create'}
      </button>
      {error && (
        <pre className="col-span-full whitespace-pre-wrap text-xs text-red-600">{error}</pre>
      )}
    </form>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-[1px] opacity-50">{label}</span>
      {children}
    </div>
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
