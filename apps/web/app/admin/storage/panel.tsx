'use client';

import { useMemo, useState, useTransition } from 'react';

export interface StorageEntryWire {
  key: string;
  size: number;
  modifiedAtIso: string;
}

export interface StoragePanelProps {
  entries: StorageEntryWire[];
  deleteAction: (key: string) => Promise<void>;
  /** Public URL to serve a stored blob (e.g. `/api/storage/`). Appended with the key. */
  serveUrlPrefix: string;
}

interface FileNode {
  type: 'file';
  name: string;
  path: string;
  entry: StorageEntryWire;
}
interface FolderNode {
  type: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
  fileCount: number;
  totalSize: number;
}
type TreeNode = FileNode | FolderNode;

export function StoragePanel({ entries, deleteAction, serveUrlPrefix }: StoragePanelProps) {
  const tree = useMemo(() => buildTree(entries), [entries]);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpansion(tree));

  const selectedNode = useMemo(() => findNode(tree, selectedPath), [tree, selectedPath]);

  const toggle = (path: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="grid grid-cols-[320px_1fr] gap-4">
      <aside className="rounded-2xl border border-stone-200/70 bg-white p-3">
        {tree.children.length === 0 ? (
          <div className="p-4 text-sm text-stone-500">(empty)</div>
        ) : (
          <TreeView
            nodes={tree.children}
            depth={0}
            selectedPath={selectedPath}
            expanded={expanded}
            onToggle={toggle}
            onSelect={(p) => setSelectedPath(p)}
          />
        )}
      </aside>
      <section className="rounded-2xl border border-stone-200/70 bg-white p-6">
        {!selectedNode ? (
          <EmptySelection count={entries.length} totalBytes={tree.totalSize} />
        ) : selectedNode.type === 'file' ? (
          <FilePreview
            node={selectedNode}
            serveUrlPrefix={serveUrlPrefix}
            deleteAction={deleteAction}
            onDeleted={() => setSelectedPath('')}
          />
        ) : (
          <FolderGallery
            node={selectedNode}
            serveUrlPrefix={serveUrlPrefix}
            onSelectFile={(p) => setSelectedPath(p)}
          />
        )}
      </section>
    </div>
  );
}

function TreeView({
  nodes,
  depth,
  selectedPath,
  expanded,
  onToggle,
  onSelect,
}: {
  nodes: TreeNode[];
  depth: number;
  selectedPath: string;
  expanded: Set<string>;
  onToggle: (p: string) => void;
  onSelect: (p: string) => void;
}) {
  return (
    <ul className="m-0 list-none p-0">
      {nodes.map((n) => {
        const isSelected = n.path === selectedPath;
        const isExpandedFolder = n.type === 'folder' && expanded.has(n.path);
        return (
          <li key={n.path}>
            <button
              type="button"
              onClick={() => {
                if (n.type === 'folder') onToggle(n.path);
                onSelect(n.path);
              }}
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] transition hover:bg-stone-100 ${
                isSelected ? 'bg-stone-900 text-white hover:bg-stone-900' : 'text-stone-700'
              }`}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
              {n.type === 'folder' ? (
                <span
                  className={`inline-block w-3 text-[10px] ${isSelected ? 'text-white' : 'text-stone-400'}`}
                >
                  {isExpandedFolder ? '▾' : '▸'}
                </span>
              ) : (
                <span className="inline-block w-3" />
              )}
              <span className={n.type === 'folder' ? 'font-medium' : 'font-mono text-[12px]'}>
                {n.name}
                {n.type === 'folder' && (
                  <span
                    className={`ml-1.5 text-[11px] ${isSelected ? 'text-white/60' : 'text-stone-400'}`}
                  >
                    {n.fileCount}
                  </span>
                )}
              </span>
            </button>
            {n.type === 'folder' && isExpandedFolder && n.children.length > 0 && (
              <TreeView
                nodes={n.children}
                depth={depth + 1}
                selectedPath={selectedPath}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FilePreview({
  node,
  serveUrlPrefix,
  deleteAction,
  onDeleted,
}: {
  node: FileNode;
  serveUrlPrefix: string;
  deleteAction: (key: string) => Promise<void>;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isImage = /\.(png|jpe?g|webp|gif)$/i.test(node.path);
  const url = `${serveUrlPrefix}${encodeURI(node.path)}`;

  const handleDelete = () => {
    if (!confirm(`Delete ${node.path}?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteAction(node.path);
        onDeleted();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="break-all font-mono text-[13px] text-stone-900">{node.path}</div>
          <div className="mt-1 flex gap-3 text-[12px] text-stone-500">
            <span>{formatBytes(node.entry.size)}</span>
            <span>·</span>
            <span>{formatDate(node.entry.modifiedAtIso)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(node.path)}
            className="rounded-full border border-stone-200 bg-white px-3 py-1 text-[11px] text-stone-700 transition hover:border-stone-400"
          >
            copy key
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11px] text-red-700 transition hover:border-red-400 hover:bg-red-100 disabled:opacity-50"
          >
            {pending ? 'deleting…' : 'delete'}
          </button>
        </div>
      </div>
      {error && <pre className="m-0 mb-3 whitespace-pre-wrap text-xs text-red-600">{error}</pre>}
      <div className="flex flex-1 items-center justify-center rounded-xl bg-stone-50 p-4">
        {isImage ? (
          // biome-ignore lint/a11y/useAltText: debug surface
          <img
            src={url}
            className="max-h-[60vh] max-w-full rounded border border-stone-200 bg-white [image-rendering:pixelated]"
          />
        ) : (
          <div className="text-sm text-stone-500">non-image file · open via link</div>
        )}
      </div>
    </div>
  );
}

function FolderGallery({
  node,
  serveUrlPrefix,
  onSelectFile,
}: {
  node: FolderNode;
  serveUrlPrefix: string;
  onSelectFile: (path: string) => void;
}) {
  const files = node.children.filter((c): c is FileNode => c.type === 'file');
  const subfolders = node.children.filter((c): c is FolderNode => c.type === 'folder');

  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3">
        <div className="font-mono text-[13px] text-stone-900">{node.path || '/'}</div>
        <div className="text-[12px] text-stone-500">
          {node.fileCount.toLocaleString()} files · {formatBytes(node.totalSize)}
        </div>
      </div>

      {subfolders.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-stone-500">
            Subfolders
          </div>
          <div className="flex flex-wrap gap-2">
            {subfolders.map((f) => (
              <button
                type="button"
                key={f.path}
                onClick={() => onSelectFile(f.path)}
                className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 font-mono text-[12px] text-stone-700 transition hover:border-stone-400 hover:bg-white"
              >
                ▸ {f.name}
                <span className="ml-1.5 text-stone-400">{f.fileCount}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {files.length > 0 ? (
        <div className="grid grid-cols-4 gap-3">
          {files.map((f) => (
            <button
              type="button"
              key={f.path}
              onClick={() => onSelectFile(f.path)}
              className="group flex flex-col rounded-xl border border-stone-200 bg-white p-2 text-left transition hover:border-stone-400"
            >
              {/\.(png|jpe?g|webp|gif)$/i.test(f.path) ? (
                // biome-ignore lint/a11y/useAltText: debug surface
                <img
                  src={`${serveUrlPrefix}${encodeURI(f.path)}`}
                  className="aspect-square w-full rounded bg-stone-100 object-cover [image-rendering:pixelated]"
                  loading="lazy"
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded bg-stone-100 text-[11px] text-stone-400">
                  no preview
                </div>
              )}
              <div className="mt-2 truncate font-mono text-[11px] text-stone-700">{f.name}</div>
              <div className="text-[10px] text-stone-400">{formatBytes(f.entry.size)}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-stone-200 p-8 text-center text-sm text-stone-500">
          no files directly in this folder
        </div>
      )}
    </div>
  );
}

function EmptySelection({ count, totalBytes }: { count: number; totalBytes: number }) {
  return (
    <div className="flex h-full min-h-[400px] flex-col items-center justify-center text-center">
      <div className="text-[15px] font-medium text-stone-700">
        {count.toLocaleString()} {count === 1 ? 'file' : 'files'} · {formatBytes(totalBytes)}
      </div>
      <p className="mx-auto mt-2 max-w-[44ch] text-sm text-stone-500">
        Pick a folder for the gallery view, or a file to preview.
      </p>
    </div>
  );
}

function buildTree(entries: StorageEntryWire[]): FolderNode {
  const root: FolderNode = {
    type: 'folder',
    name: '',
    path: '',
    children: [],
    fileCount: 0,
    totalSize: 0,
  };
  const folderIndex = new Map<string, FolderNode>([['', root]]);

  for (const entry of entries) {
    const parts = entry.key.split('/');
    const fileName = parts.pop();
    if (!fileName) continue;

    let parentPath = '';
    let parent = root;
    for (const part of parts) {
      const nextPath = parentPath ? `${parentPath}/${part}` : part;
      let folder = folderIndex.get(nextPath);
      if (!folder) {
        folder = {
          type: 'folder',
          name: part,
          path: nextPath,
          children: [],
          fileCount: 0,
          totalSize: 0,
        };
        folderIndex.set(nextPath, folder);
        parent.children.push(folder);
      }
      parent = folder;
      parentPath = nextPath;
    }

    const fileNode: FileNode = {
      type: 'file',
      name: fileName,
      path: entry.key,
      entry,
    };
    parent.children.push(fileNode);

    // Roll counts/sizes up the chain.
    let cursor: string | null = parentPath;
    while (cursor !== null) {
      const f = folderIndex.get(cursor);
      if (f) {
        f.fileCount += 1;
        f.totalSize += entry.size;
      }
      const slashIdx = cursor.lastIndexOf('/');
      cursor = slashIdx === -1 ? (cursor === '' ? null : '') : cursor.slice(0, slashIdx);
    }
  }

  // Sort each folder's children: folders first (alpha), then files (alpha).
  const sortRecursive = (node: FolderNode) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of node.children) if (c.type === 'folder') sortRecursive(c);
  };
  sortRecursive(root);

  return root;
}

function initialExpansion(root: FolderNode): Set<string> {
  // Default: expand top-level folders only.
  return new Set(root.children.filter((c) => c.type === 'folder').map((c) => c.path));
}

function findNode(root: FolderNode, path: string): TreeNode | null {
  if (path === '') return null;
  const parts = path.split('/');
  let cursor: TreeNode = root;
  for (const part of parts) {
    if (cursor.type !== 'folder') return null;
    const child: TreeNode | undefined = cursor.children.find((c) => c.name === part);
    if (!child) return null;
    cursor = child;
  }
  return cursor;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
