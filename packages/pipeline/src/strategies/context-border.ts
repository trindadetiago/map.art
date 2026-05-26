import sharp from 'sharp';
import type { GenerationStrategy, PipelineTileInput, PipelineTileOutput } from '../types';

const BORDER_FRACTION = 0.2;

type Key = string;
const keyOf = (col: number, row: number): Key => `${col},${row}`;

/**
 * One of the 8 neighbors around the current tile. Describes where in the
 * hybrid canvas to paint the neighbor's strip, and what region to crop out
 * of the neighbor's own (north-up) tile PNG. Each function takes (b, t) =
 * (borderPx, tilePixelSize) and returns a pixel coordinate.
 *
 * Tile PNGs are oriented north-up: top=north, bottom=south, left=west,
 * right=east. The hybrid canvas uses the same orientation.
 */
interface NeighborSpec {
  dc: number;
  dr: number;
  hybridLeft: (b: number, t: number) => number;
  hybridTop: (b: number, t: number) => number;
  cropLeft: (b: number, t: number) => number;
  cropTop: (b: number, t: number) => number;
  cropW: (b: number, t: number) => number;
  cropH: (b: number, t: number) => number;
}

const NEIGHBORS: readonly NeighborSpec[] = [
  // N: bottom strip of north neighbor → top strip of hybrid
  {
    dc: 0,
    dr: 1,
    hybridLeft: (b) => b,
    hybridTop: () => 0,
    cropLeft: () => 0,
    cropTop: (b, t) => t - b,
    cropW: (_b, t) => t,
    cropH: (b) => b,
  },
  // S: top strip → bottom strip of hybrid
  {
    dc: 0,
    dr: -1,
    hybridLeft: (b) => b,
    hybridTop: (b, t) => b + t,
    cropLeft: () => 0,
    cropTop: () => 0,
    cropW: (_b, t) => t,
    cropH: (b) => b,
  },
  // E: left strip of east neighbor → right strip of hybrid
  {
    dc: 1,
    dr: 0,
    hybridLeft: (b, t) => b + t,
    hybridTop: (b) => b,
    cropLeft: () => 0,
    cropTop: () => 0,
    cropW: (b) => b,
    cropH: (_b, t) => t,
  },
  // W: right strip of west neighbor → left strip of hybrid
  {
    dc: -1,
    dr: 0,
    hybridLeft: () => 0,
    hybridTop: (b) => b,
    cropLeft: (b, t) => t - b,
    cropTop: () => 0,
    cropW: (b) => b,
    cropH: (_b, t) => t,
  },
  // NE: bottom-left corner → top-right corner of hybrid
  {
    dc: 1,
    dr: 1,
    hybridLeft: (b, t) => b + t,
    hybridTop: () => 0,
    cropLeft: () => 0,
    cropTop: (b, t) => t - b,
    cropW: (b) => b,
    cropH: (b) => b,
  },
  // NW: bottom-right corner → top-left corner of hybrid
  {
    dc: -1,
    dr: 1,
    hybridLeft: () => 0,
    hybridTop: () => 0,
    cropLeft: (b, t) => t - b,
    cropTop: (b, t) => t - b,
    cropW: (b) => b,
    cropH: (b) => b,
  },
  // SE: top-left corner → bottom-right corner of hybrid
  {
    dc: 1,
    dr: -1,
    hybridLeft: (b, t) => b + t,
    hybridTop: (b, t) => b + t,
    cropLeft: () => 0,
    cropTop: () => 0,
    cropW: (b) => b,
    cropH: (b) => b,
  },
  // SW: top-right corner → bottom-left corner of hybrid
  {
    dc: -1,
    dr: -1,
    hybridLeft: () => 0,
    hybridTop: (b, t) => b + t,
    cropLeft: (b, t) => t - b,
    cropTop: () => 0,
    cropW: (b) => b,
    cropH: (b) => b,
  },
];

export const contextBorderStrategy: GenerationStrategy = {
  name: 'context-border',
  description:
    'Greedy tile order. Each model call sees the tile plus a 20% border strip cropped from each neighbor. Neighbors use their stylized version if already generated, otherwise the rendered version, so style propagates across the grid. Model stylizes the whole hybrid; we crop the center back out.',
  async run(input, model) {
    const t = input.project.tilePixelSize;
    const b = Math.round(BORDER_FRACTION * t);
    const hybridSize = t + 2 * b;
    const total = input.tiles.length;

    console.log(
      `[pipeline:context-border] starting — ${total} tile(s), border=${b}px, hybrid=${hybridSize}px`,
    );

    // Normalize every rendered tile to tilePixelSize up front so crop offsets
    // are predictable. Sharp's extract() throws on out-of-bounds.
    const rendered = new Map<Key, Buffer>();
    for (const tile of input.tiles) {
      const normalized = await sharp(tile.renderedPng)
        .resize(t, t, { fit: 'fill' })
        .png()
        .toBuffer();
      rendered.set(keyOf(tile.col, tile.row), normalized);
    }

    const generated = new Map<Key, Buffer>();
    const outputs = new Map<Key, PipelineTileOutput>();
    const pending = new Set<Key>(rendered.keys());

    // Row-major sorted copy — picks deterministic tie-breaker for the greedy order.
    const rowMajor = [...input.tiles].sort((a, b) => a.row - b.row || a.col - b.col);

    while (pending.size > 0) {
      let best: PipelineTileInput | null = null;
      let bestScore = -1;
      for (const tile of rowMajor) {
        const k = keyOf(tile.col, tile.row);
        if (!pending.has(k)) continue;
        let score = 0;
        for (const n of NEIGHBORS) {
          if (generated.has(keyOf(tile.col + n.dc, tile.row + n.dr))) score++;
        }
        if (score > bestScore) {
          best = tile;
          bestScore = score;
        }
      }
      if (!best) break;

      const tile = best;
      const k = keyOf(tile.col, tile.row);
      pending.delete(k);

      const renderedTile = rendered.get(k);
      if (!renderedTile) continue;
      const composites: sharp.OverlayOptions[] = [{ input: renderedTile, left: b, top: b }];
      const neighborSources: Record<string, 'generated' | 'rendered' | 'missing'> = {};
      for (const n of NEIGHBORS) {
        const nk = keyOf(tile.col + n.dc, tile.row + n.dr);
        const genPng = generated.get(nk);
        const rendPng = rendered.get(nk);
        const src = genPng ?? rendPng;
        neighborSources[`${n.dc},${n.dr}`] = genPng
          ? 'generated'
          : rendPng
            ? 'rendered'
            : 'missing';
        if (!src) continue;
        const strip = await sharp(src)
          .extract({
            left: n.cropLeft(b, t),
            top: n.cropTop(b, t),
            width: n.cropW(b, t),
            height: n.cropH(b, t),
          })
          .toBuffer();
        composites.push({ input: strip, left: n.hybridLeft(b, t), top: n.hybridTop(b, t) });
      }

      const hybridPng = await sharp({
        create: {
          width: hybridSize,
          height: hybridSize,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(composites)
        .png()
        .toBuffer();

      const contextPrompt = [
        input.prompt,
        '',
        `The input image is ${hybridSize}×${hybridSize} px. The center ${t}×${t} region is the main tile to stylize; the surrounding ${b}px border shows the ground that continues into neighboring tiles and is there so your stylization flows continuously across tile edges. Stylize the entire image with a single consistent style — especially matching any already-stylized parts of the border. Return an image the same ${hybridSize}×${hybridSize} size.`,
      ].join('\n');

      const started = Date.now();
      console.log(
        `[pipeline:context-border] tile (c=${tile.col}, r=${tile.row}) — stylized neighbors=${bestScore}/8 — generating`,
      );
      const result = await model.generate({ input: hybridPng, prompt: contextPrompt });
      const wallClockMs = Date.now() - started;

      // Model output resolution is not guaranteed. Canonicalize to hybridSize
      // so the center crop lands on the right pixels regardless.
      const centerPng = await sharp(result.image)
        .resize(hybridSize, hybridSize, { fit: 'fill' })
        .extract({ left: b, top: b, width: t, height: t })
        .png()
        .toBuffer();

      generated.set(k, centerPng);
      outputs.set(k, {
        col: tile.col,
        row: tile.row,
        generatedPng: centerPng,
        metadata: {
          strategy: 'context-border',
          model: result.metadata.model,
          durationMs: result.metadata.durationMs,
          textResponse: result.metadata.textResponse,
          wallClockMs,
          borderPx: b,
          hybridSize,
          stylizedNeighborCount: bestScore,
          neighbors: neighborSources,
        },
      });
      const done = outputs.size;
      console.log(
        `[pipeline:context-border] tile (c=${tile.col}, r=${tile.row}) — done in ${wallClockMs}ms (model ${result.metadata.durationMs}ms) — ${done}/${total}`,
      );
      input.onProgress?.(Array.from(outputs.values()), total);
    }

    console.log(`[pipeline:context-border] all ${total} tile(s) done`);
    return Array.from(outputs.values());
  },
};
