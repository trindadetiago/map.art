/**
 * Stylize-queue consumer.
 *
 * Polls the tiles table for stylize-ready work via claimNextStylize (a
 * render/done tile whose neighbours have all rendered, promoted into the
 * stylize phase — or a stylize tile that failed back to pending). For each
 * claimed tile: load its raw render, gather its already-stylized neighbours,
 * build the Algorithm-A composite, run the model, crop the result, write the
 * PNG, and mark the tile done — or bump its retry counter on failure.
 *
 * Mirrors apps/worker-render/consumer.ts. No HTTP surface — this worker needs none.
 */
import { claimNextStylize, completeStylize, failOrRetry, tilesByIds } from '@mapart/db/repos';
import type { ModelClient } from '@mapart/models';
import { getStorage } from '@mapart/storage';
import {
  STYLIZE_PROMPT,
  type StylizedNeighbors,
  buildComposite,
  extractStylized,
} from '@mapart/stylize';

/** Wait between polls when the queue is empty. A claimed tile loops back with no wait. */
export const IDLE_POLL_MS = 30_000;

export interface StylizeConsumer {
  /** Ask the loop to stop after the in-flight tile; `done` resolves once it has. */
  stop(): void;
  /** Resolves when the loop has fully exited. */
  readonly done: Promise<void>;
}

type ClaimedTile = NonNullable<Awaited<ReturnType<typeof claimNextStylize>>>;
type Dir = keyof StylizedNeighbors;

/** Error message including the underlying `cause` — e.g. fetch's ECONNREFUSED. */
const errMsg = (e: unknown): string => {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as { cause?: unknown }).cause;
  if (cause instanceof Error) return `${e.message} (${cause.message})`;
  if (cause && typeof cause === 'object' && 'code' in cause) {
    return `${e.message} (${(cause as { code: unknown }).code})`;
  }
  return e.message;
};

/** Storage key for a tile's stylized output. Mirrors docs/architecture.html. */
export function stylizeKey(projectId: string, x: number, y: number): string {
  return `stylize/${projectId}/${x}_${y}.png`;
}

/**
 * Map a grid offset to a composite slot. The composite is built in render-image
 * space, where +y is image-up (renderer row convention), so the y+1 neighbour
 * is the one sitting ABOVE the tile and belongs in the top ("north") strip.
 * west = lower x.
 */
function directionSlot(dx: number, dy: number): Dir | null {
  if (dx === 0 && dy === 1) return 'north';
  if (dx === 0 && dy === -1) return 'south';
  if (dx === -1 && dy === 0) return 'west';
  if (dx === 1 && dy === 0) return 'east';
  if (dx === -1 && dy === 1) return 'northwest';
  if (dx === 1 && dy === 1) return 'northeast';
  if (dx === -1 && dy === -1) return 'southwest';
  if (dx === 1 && dy === -1) return 'southeast';
  return null;
}

/** Load the direction-keyed buffers for the tile's ALREADY-stylized neighbours. */
async function loadStylizedNeighbors(tile: ClaimedTile): Promise<StylizedNeighbors> {
  if (tile.neighbors.length === 0) return {};
  const rows = await tilesByIds(tile.neighbors);
  const storage = getStorage();
  const out: StylizedNeighbors = {};
  for (const n of rows) {
    if (!n.stylizedImgPath) continue; // not stylized yet → treat as absent
    const slot = directionSlot(n.x - tile.x, n.y - tile.y);
    if (!slot) continue;
    out[slot] = await storage.get(n.stylizedImgPath);
  }
  return out;
}

export function startStylizeConsumer(
  model: ModelClient,
  log: (msg: string) => void,
): StylizeConsumer {
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

  let idleLogged = false;
  const done = (async () => {
    while (!stopping) {
      let tile: Awaited<ReturnType<typeof claimNextStylize>>;
      try {
        tile = await claimNextStylize();
      } catch (e) {
        log(`claim query failed: ${errMsg(e)} — retrying in ${IDLE_POLL_MS / 1000}s`);
        await idle();
        continue;
      }

      if (!tile) {
        if (!idleLogged) {
          log(`no stylize-ready tiles — polling every ${IDLE_POLL_MS / 1000}s`);
          idleLogged = true;
        }
        await idle(); // empty queue — back off
        continue;
      }
      idleLogged = false;

      const startedAt = Date.now();
      const at = `${tile.x},${tile.y}`;
      try {
        if (!tile.renderedImgPath) throw new Error('claimed tile has no renderedImgPath');
        log(`tile ${at}: claimed (attempt ${tile.retryAttempt}), loading render + neighbours`);

        const render = await getStorage().get(tile.renderedImgPath);
        const neighbors = await loadStylizedNeighbors(tile);
        const slots = Object.keys(neighbors);
        log(
          `tile ${at}: ${slots.length}/${tile.neighbors.length} neighbours stylized${
            slots.length ? ` [${slots.join(', ')}]` : ''
          }`,
        );

        const { composite, bbox } = await buildComposite(render, neighbors);
        log(`tile ${at}: composite built (bbox ${bbox.join(',')}), calling ${model.name}`);

        const genStart = Date.now();
        const { image } = await model.generate({ input: composite, prompt: STYLIZE_PROMPT });
        const stylized = await extractStylized(image, bbox);
        const key = stylizeKey(tile.projectId, tile.x, tile.y);
        await getStorage().put(key, stylized);
        await completeStylize(tile.id, key);
        log(
          `tile ${at} → ${key} (${Date.now() - startedAt}ms total, ${Date.now() - genStart}ms model)`,
        );
      } catch (e) {
        let status = 'unknown';
        try {
          status = await failOrRetry(tile.id);
        } catch (err) {
          log(`failOrRetry failed for tile ${tile.id}: ${errMsg(err)}`);
        }
        log(`tile ${at} stylize failed: ${errMsg(e)} → ${status}`);
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
