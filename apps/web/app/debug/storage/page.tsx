import { getStorage } from '@mapart/storage';
import { type StorageEntryWire, StoragePanel } from '@mapart/storage/debug';

async function listAction(prefix: string): Promise<StorageEntryWire[]> {
  'use server';
  const entries = await getStorage().list(prefix);
  return entries.map((e) => ({
    key: e.key,
    size: e.size,
    modifiedAtIso: e.modifiedAt.toISOString(),
  }));
}

async function deleteAction(key: string): Promise<void> {
  'use server';
  await getStorage().delete(key);
}

export default function StorageDebugPage() {
  return (
    <div>
      <h1 style={{ marginTop: 0 }}>storage</h1>
      <p style={{ opacity: 0.7, maxWidth: 640 }}>
        Browse the local storage root (<code>&lt;repo&gt;/data/</code>). Files land here when you
        hit <strong>save</strong> in the renderer or models panels.
      </p>
      <StoragePanel
        listAction={listAction}
        deleteAction={deleteAction}
        serveUrlPrefix="/api/storage/"
      />
    </div>
  );
}
