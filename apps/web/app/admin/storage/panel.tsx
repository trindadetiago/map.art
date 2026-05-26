'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

export interface StorageEntryWire {
  key: string;
  size: number;
  modifiedAtIso: string;
}

export interface StoragePanelProps {
  listAction: (prefix: string) => Promise<StorageEntryWire[]>;
  deleteAction: (key: string) => Promise<void>;
  /** Public URL to serve a stored blob (e.g. `/api/storage/`). Appended with the key. */
  serveUrlPrefix: string;
}

export function StoragePanel({ listAction, deleteAction, serveUrlPrefix }: StoragePanelProps) {
  const [prefix, setPrefix] = useState('');
  const [entries, setEntries] = useState<StorageEntryWire[]>([]);
  const [selected, setSelected] = useState<StorageEntryWire | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    (pfx: string = prefix) => {
      setError(null);
      startTransition(async () => {
        try {
          const result = await listAction(pfx);
          setEntries(result);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    },
    [listAction, prefix],
  );

  useEffect(() => {
    refresh('');
  }, [refresh]);

  const onDelete = (key: string) => {
    if (!confirm(`Delete ${key}?`)) return;
    startTransition(async () => {
      try {
        await deleteAction(key);
        if (selected?.key === key) setSelected(null);
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="grid grid-cols-2 gap-6">
      <div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            refresh();
          }}
          className="mb-3 flex gap-2"
        >
          <input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="prefix (empty = all)"
            className="flex-1 p-1"
          />
          <button type="submit" disabled={pending}>
            {pending ? '…' : 'list'}
          </button>
        </form>

        {error && <pre className="whitespace-pre-wrap text-red-600">{error}</pre>}
        <div className="mb-1 text-xs opacity-60">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </div>
        <div className="max-h-[520px] overflow-auto rounded border border-neutral-200">
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {entries.map((e) => {
                const isSelected = selected?.key === e.key;
                return (
                  <tr
                    key={e.key}
                    className={`border-b border-neutral-100 ${isSelected ? 'bg-indigo-50' : ''}`}
                  >
                    <td className="break-all px-2.5 py-1.5 font-mono">
                      <button
                        type="button"
                        onClick={() => setSelected(e)}
                        className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left font-inherit text-inherit"
                      >
                        {e.key}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right opacity-70">
                      {(e.size / 1024).toFixed(1)} KB
                    </td>
                    <td className="px-2.5 py-1.5">
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onDelete(e.key);
                        }}
                        className="text-[11px]"
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                );
              })}
              {entries.length === 0 && !pending && (
                <tr>
                  <td className="p-3 opacity-50">(empty)</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs opacity-60">preview{selected ? ` · ${selected.key}` : ''}</div>
        {selected ? (
          isImageKey(selected.key) ? (
            // biome-ignore lint/a11y/useAltText: debug surface
            <img
              src={`${serveUrlPrefix}${encodeURI(selected.key)}`}
              className="max-w-full border border-neutral-300 [image-rendering:pixelated]"
            />
          ) : (
            <div className="opacity-50">non-image file · size {selected.size} bytes</div>
          )
        ) : (
          <div className="opacity-50">select a key to preview</div>
        )}
      </div>
    </div>
  );
}

function isImageKey(key: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(key);
}
