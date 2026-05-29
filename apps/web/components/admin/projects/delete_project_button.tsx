'use client';

import { useTransition } from 'react';

export function DeleteProjectButton({
  id,
  label,
  action,
}: {
  id: string;
  label: string;
  action: (id: string) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm(`Delete "${label}"?`)) return;
        startTransition(() => action(id));
      }}
      className="text-[11px] text-stone-400 underline-offset-4 transition hover:text-red-600 hover:underline disabled:opacity-50"
    >
      {pending ? 'deleting…' : 'delete'}
    </button>
  );
}
