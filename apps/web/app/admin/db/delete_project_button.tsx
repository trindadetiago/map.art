'use client';

import { useTransition } from 'react';

export function DeleteProjectButton({
  id,
  slug,
  action,
}: {
  id: string;
  slug: string;
  action: (id: string) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(`Delete project "${slug}"?\nAll tiles, versions and jobs for it will cascade.`)
        )
          return;
        startTransition(() => action(id));
      }}
      className="cursor-pointer rounded border border-neutral-300 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
    >
      {pending ? '…' : 'delete'}
    </button>
  );
}
