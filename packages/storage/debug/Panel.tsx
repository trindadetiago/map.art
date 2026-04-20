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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      <div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            refresh();
          }}
          style={{ display: 'flex', gap: 8, marginBottom: 12 }}
        >
          <input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="prefix (empty = all)"
            style={{ flex: 1, padding: 4 }}
          />
          <button type="submit" disabled={pending}>
            {pending ? '…' : 'list'}
          </button>
        </form>

        {error && <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap' }}>{error}</pre>}
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </div>
        <div
          style={{ border: '1px solid #e5e5e5', borderRadius: 4, maxHeight: 520, overflow: 'auto' }}
        >
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <tbody>
              {entries.map((e) => {
                const isSelected = selected?.key === e.key;
                return (
                  <tr
                    key={e.key}
                    style={{
                      background: isSelected ? '#eef2ff' : 'transparent',
                      borderBottom: '1px solid #f3f4f6',
                    }}
                  >
                    <td
                      style={{
                        padding: '6px 10px',
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setSelected(e)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: 0,
                          border: 0,
                          background: 'transparent',
                          font: 'inherit',
                          cursor: 'pointer',
                        }}
                      >
                        {e.key}
                      </button>
                    </td>
                    <td
                      style={{
                        padding: '6px 10px',
                        textAlign: 'right',
                        whiteSpace: 'nowrap',
                        opacity: 0.7,
                      }}
                    >
                      {(e.size / 1024).toFixed(1)} KB
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onDelete(e.key);
                        }}
                        style={{ fontSize: 11 }}
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                );
              })}
              {entries.length === 0 && !pending && (
                <tr>
                  <td style={{ padding: 12, opacity: 0.5 }}>(empty)</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
          preview{selected ? ` · ${selected.key}` : ''}
        </div>
        {selected ? (
          isImageKey(selected.key) ? (
            // biome-ignore lint/a11y/useAltText: debug surface
            <img
              src={`${serveUrlPrefix}${encodeURI(selected.key)}`}
              style={{
                maxWidth: '100%',
                border: '1px solid #ccc',
                imageRendering: 'pixelated',
              }}
            />
          ) : (
            <div style={{ opacity: 0.5 }}>non-image file · size {selected.size} bytes</div>
          )
        ) : (
          <div style={{ opacity: 0.5 }}>select a key to preview</div>
        )}
      </div>
    </div>
  );
}

function isImageKey(key: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(key);
}
