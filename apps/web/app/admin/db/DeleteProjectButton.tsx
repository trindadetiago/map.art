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
      style={btnStyle}
    >
      {pending ? '…' : 'delete'}
    </button>
  );
}

const btnStyle = {
  fontSize: 11,
  padding: '6px 12px',
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
};
