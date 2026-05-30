/**
 * Render-queue consumer.
 *
 * Polls the tiles table for render/pending work, claims one row at a time with
 * FOR UPDATE SKIP LOCKED (via @mapart/db), renders it, writes the PNG to blob
 * storage, and marks the tile done — or bumps its retry counter on failure.
 * This is the worker's real job; POST /render is only for dev smoke tests.
 *
 * Render pose/output is fixed (RENDER_DEFAULTS); only the tile center varies,
 * so each tile maps to a request through renderParamsForLatLng.
 */
import { claimNextRender, completeRender, failOrRetry } from '@mapart/db/repos';
import { renderParamsForLatLng } from '@mapart/renderer';
import { getStorage } from '@mapart/storage';

export interface RenderRequest {
  lat: number;
  lng: number;
  pitch: number;
  yaw: number;
  zoom: number;
  size: number;
}

export type RenderFn = (req: RenderRequest) => Promise<Buffer>;

/** Wait between polls when the queue is empty. A claimed tile loops back with no wait. */
export const IDLE_POLL_MS = 30_000;

export interface RenderConsumer {
  /** Ask the loop to stop after the in-flight tile; `done` resolves once it has. */
  stop(): void;
  /** Resolves when the loop has fully exited. */
  readonly done: Promise<void>;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Storage key for a tile's raw render. Mirrors docs/architecture.html. */
export function renderKey(projectId: string, x: number, y: number): string {
  return `render/${projectId}/${x}_${y}.png`;
}

export function startRenderConsumer(render: RenderFn, log: (msg: string) => void): RenderConsumer {
  let stopping = false;
  let wake: (() => void) | null = null;

  // Sleep that a stop() can cut short, so shutdown doesn't wait out the poll interval.
  const idle = (): Promise<void> =>
    new Promise((res) => {
      const timer = setTimeout(() => {
        wake = null;
        res();
      }, IDLE_POLL_MS);
      wake = () => {
        clearTimeout(timer);
        wake = null;
        res();
      };
    });

  const done = (async () => {
    while (!stopping) {
      let tile: Awaited<ReturnType<typeof claimNextRender>>;
      try {
        tile = await claimNextRender();
      } catch (e) {
        log(`claim query failed: ${errMsg(e)} — retrying in ${IDLE_POLL_MS / 1000}s`);
        await idle();
        continue;
      }

      if (!tile) {
        await idle(); // empty queue — back off
        continue;
      }

      const startedAt = Date.now();
      try {
        const p = renderParamsForLatLng({ lat: tile.lat, lng: tile.lng });
        const png = await render({
          lat: tile.lat,
          lng: tile.lng,
          pitch: p.pitch,
          yaw: p.yaw,
          zoom: p.zoom,
          size: p.size,
        });
        const key = renderKey(tile.projectId, tile.x, tile.y);
        await getStorage().put(key, png);
        await completeRender(tile.id, key);
        log(`tile ${tile.x},${tile.y} → ${key} (${Date.now() - startedAt}ms)`);
      } catch (e) {
        let status = 'unknown';
        try {
          status = await failOrRetry(tile.id);
        } catch (err) {
          log(`failOrRetry failed for tile ${tile.id}: ${errMsg(err)}`);
        }
        log(`tile ${tile.x},${tile.y} render failed: ${errMsg(e)} → ${status}`);
      }
      // claimed a tile this round — loop straight back to drain the backlog
    }
  })();

  return {
    stop() {
      stopping = true;
      wake?.();
    },
    done,
  };
}
