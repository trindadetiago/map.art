import { env } from '@mapart/env';
import { getStorage } from '@mapart/storage';
import { type StorageEntryWire, StoragePanel } from './panel';

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

function deriveConsoleUrl(endpoint: string | undefined): string | null {
  if (!endpoint) return null;
  try {
    const u = new URL(endpoint);
    const apiPort = Number.parseInt(u.port || '9000', 10);
    return `${u.protocol}//${u.hostname}:${apiPort + 1}`;
  } catch {
    return null;
  }
}

export default function StorageDebugPage() {
  const isS3 = env.storageBackend === 's3';
  const bucket = env.s3Bucket;
  const endpoint = env.s3Endpoint;
  const consoleUrl = isS3 ? deriveConsoleUrl(endpoint) : null;

  return (
    <div>
      <div className="mt-0 flex items-baseline gap-3">
        <h1 className="m-0">storage</h1>
        {consoleUrl && (
          <a
            href={consoleUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-current px-2.5 py-1 text-[13px] no-underline opacity-70 hover:opacity-100"
          >
            Open MinIO console ↗
          </a>
        )}
      </div>
      <p className="max-w-[640px] opacity-70">
        {isS3 ? (
          <>
            Browse the S3 bucket <code>{bucket}</code>
            {endpoint ? (
              <>
                {' '}
                via <code>{endpoint}</code>
              </>
            ) : null}
            . Files land here when you hit <strong>save</strong> in the renderer or models panels.
          </>
        ) : (
          <>
            Browse the local storage root (<code>&lt;repo&gt;/data/</code>). Files land here when
            you hit <strong>save</strong> in the renderer or models panels.
          </>
        )}
      </p>
      <StoragePanel
        listAction={listAction}
        deleteAction={deleteAction}
        serveUrlPrefix="/api/storage/"
      />
    </div>
  );
}
