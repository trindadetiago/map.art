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
import { claimNextRender, completeRender, failOrRetry, findRenderedAt } from '@mapart/db/repos';
import type { Logger } from '@mapart/logger';
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

/** Storage key for a tile's raw render. Mirrors docs/architecture.html. */
export function renderKey(projectId: string, x: number, y: number): string {
  return `render/${projectId}/${x}_${y}.png`;
}

export function startRenderConsumer(render: RenderFn, log: Logger): RenderConsumer {
  let stopping = false;
  let wake: (() => void) | null = null;

  // Sleep that a stop() can cut short, so shutdown doesn't wait out the poll interval.
  const idle = (): Promise<void> =>
    new Promise((res) => {
      // stop() may have landed during the claim that preceded us — when wake was
      // still null and the signal was lost. Re-check here so we never start a full
      // poll-interval sleep after a stop was already requested.
      if (stopping) {
        res();
        return;
      }
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

  let idleLogged = false;
  const done = (async () => {
    while (!stopping) {
      let tile: Awaited<ReturnType<typeof claimNextRender>>;
      try {
        tile = await claimNextRender();
      } catch (e) {
        log.error('claim query failed — backing off', { err: e, retryInMs: IDLE_POLL_MS });
        await idle();
        continue;
      }

      if (!tile) {
        if (!idleLogged) {
          log.info('no render-pending tiles — idle', { idlePollMs: IDLE_POLL_MS });
          idleLogged = true;
        }
        await idle(); // empty queue — back off
        continue;
      }
      idleLogged = false;

      const startedAt = Date.now();
      try {
        const key = renderKey(tile.projectId, tile.x, tile.y);
        const storage = getStorage();

        // A render is fully determined by (lat, lng) + the fixed pose, so if any
        // tile already rendered this exact point and its blob still exists, copy
        // that PNG instead of paying for another headless render.
        const cachedKey = await findRenderedAt(tile.lat, tile.lng);
        let png: Buffer;
        let reusedFrom: string | null = null;
        if (cachedKey && cachedKey !== key && (await storage.has(cachedKey))) {
          png = await storage.get(cachedKey);
          reusedFrom = cachedKey;
        } else {
          const p = renderParamsForLatLng({ lat: tile.lat, lng: tile.lng });
          png = await render({
            lat: tile.lat,
            lng: tile.lng,
            pitch: p.pitch,
            yaw: p.yaw,
            zoom: p.zoom,
            size: p.size,
          });
        }

        await storage.put(key, png);
        await completeRender(tile.id, key);
        log.info('tile rendered', {
          x: tile.x,
          y: tile.y,
          key,
          source: reusedFrom ? 'reused' : 'rendered',
          ...(reusedFrom ? { reusedFrom } : {}),
          ms: Date.now() - startedAt,
        });
      } catch (e) {
        let status = 'unknown';
        try {
          status = await failOrRetry(tile.id);
        } catch (err) {
          log.error('failOrRetry failed', { tileId: tile.id, err });
        }
        log.error('tile render failed', { x: tile.x, y: tile.y, status, err: e });
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
