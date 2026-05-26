'use client';

import { useState, useTransition } from 'react';

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
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr) auto',
        gap: 8,
        alignItems: 'end',
        fontSize: 13,
      }}
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
          style={inputStyle}
        />
      </Labeled>
      <Labeled label="slug">
        <input
          name="slug"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          style={inputStyle}
        />
      </Labeled>
      <Labeled label="pitch">
        <input name="pitch" type="number" defaultValue={30} step={1} style={inputStyle} />
      </Labeled>
      <Labeled label="yaw">
        <input name="yaw" type="number" defaultValue={45} step={1} style={inputStyle} />
      </Labeled>
      <Labeled label="center lat">
        <input
          name="centerLat"
          type="number"
          defaultValue={-7.115}
          step={0.0001}
          style={inputStyle}
        />
      </Labeled>
      <Labeled label="center lng">
        <input
          name="centerLng"
          type="number"
          defaultValue={-34.861}
          step={0.0001}
          style={inputStyle}
        />
      </Labeled>
      <button type="submit" disabled={pending} style={btnStyle}>
        {pending ? '…' : 'create'}
      </button>
      {error && (
        <pre
          style={{ gridColumn: '1 / -1', color: 'crimson', whiteSpace: 'pre-wrap', fontSize: 12 }}
        >
          {error}
        </pre>
      )}
    </form>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.5 }}>
        {label}
      </span>
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

const inputStyle = { padding: '4px 6px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4 };
const btnStyle = {
  fontSize: 12,
  padding: '6px 12px',
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
};
