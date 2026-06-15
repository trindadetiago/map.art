# Water-Hallucination Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the stylize model from inventing land/islands inside open water by detecting water in the *input render* and neutralizing its texture before the model sees it.

**Architecture:** The model hallucinates land because aerial water carries high-frequency texture (waves, glint, turbidity) that its "texture → pixel-art structure" job converts into islands. We add a pure, server-side helper to `@mapart/stylize` that (1) builds a water mask from the input render via simple color-based DIP and (2) blurs the masked water region with a feathered edge, then feeds that neutralized render into the existing `buildComposite → model → extractStylized` pipeline. The model still draws the coastline itself (so it stays organic), but it never sees the ambiguous water texture. No DB schema change, no new phase, no extra model calls; on near-pure-water tiles it just blurs the whole frame.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), `sharp` for raster ops, `vitest` for tests. Everything lives in `packages/stylize` (already `sharp`-based) plus a small wiring change in `apps/worker-stylize/consumer.ts`.

---

## File Structure

- **Create** `packages/stylize/src/water.ts` — the water detector + neutralizer. Pure functions over `Buffer`s. One responsibility: turn a render into a water mask and a texture-neutralized render.
- **Create** `packages/stylize/test/water.test.ts` — unit tests for both functions using synthetic half-water/half-land images.
- **Modify** `packages/stylize/src/index.ts` — export the new helpers.
- **Modify** `packages/stylize/src/keys.ts` — add `water-mask` and `neutralized-input` to `STYLIZE_STEPS` so both artifacts are persisted per tile for threshold tuning and inspection.
- **Modify** `apps/worker-stylize/consumer.ts` — compute the mask, neutralize the render before `buildComposite`, log coverage, persist the two new artifacts.

**Threshold tuning note:** The color thresholds (`MIN_BLUE_DOMINANCE`, `MIN_BLUE_GREEN_RATIO`) are first-pass values chosen to separate blue/teal water from green vegetation, sand, gray roofs, and shadows. They are exported constants and the `water-mask` artifact is persisted per tile precisely so they can be eyeballed and tuned against real renders after this lands. Texture-based refinement is intentionally out of scope for v1 (YAGNI).

---

### Task 1: Water detection (`detectWaterMask`)

**Files:**
- Create: `packages/stylize/src/water.ts`
- Test: `packages/stylize/test/water.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/stylize/test/water.test.ts`:

```ts
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { detectWaterMask } from '../src/water';

const WATER = { r: 20, g: 40, b: 120 }; // blue/teal water
const LAND = { r: 40, g: 120, b: 30 }; // green vegetation

/** A WxH image: left half water-blue, right half land-green. */
async function halfWaterLand(width = 64, height = 64): Promise<Buffer> {
  const half = await sharp({
    create: { width: width / 2, height, channels: 3, background: WATER },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background: LAND } })
    .composite([{ input: half, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

describe('detectWaterMask', () => {
  it('flags the water half and clears the land half', async () => {
    const img = await halfWaterLand(64, 64);
    const { mask, width, height, coverage } = await detectWaterMask(img);
    expect(width).toBe(64);
    expect(height).toBe(64);
    expect(coverage).toBeCloseTo(0.5, 2);
    expect(mask[20 * width + 10]).toBe(255); // left → water
    expect(mask[20 * width + 54]).toBe(0); // right → land
  });

  it('does not flag gray roofs or shadows as water', async () => {
    const roof = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 130, g: 130, b: 135 } },
    })
      .png()
      .toBuffer();
    const { coverage } = await detectWaterMask(roof);
    expect(coverage).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mapart/stylize exec vitest run test/water.test.ts`
Expected: FAIL — `Failed to resolve import "../src/water"` / `detectWaterMask is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/stylize/src/water.ts`:

```ts
import sharp from 'sharp';

/**
 * Minimum amount the blue channel must exceed the red channel for a pixel to
 * read as water. Keeps near-gray roofs/shadows (b ≈ r) out of the mask.
 */
export const MIN_BLUE_DOMINANCE = 15;

/**
 * Blue must be at least this fraction of green. Catches teal water (green high
 * too) while rejecting vegetation, where blue sits far below green.
 */
export const MIN_BLUE_GREEN_RATIO = 0.7;

export interface WaterMask {
  /** Single-channel (0 or 255) buffer, row-major, length width*height. */
  mask: Buffer;
  width: number;
  height: number;
  /** Fraction of pixels classified as water, 0..1. */
  coverage: number;
}

/**
 * Classify each pixel of an aerial render as water (255) or not (0) using a
 * simple color rule: blue clearly dominant over red AND not far below green.
 * Tuned to split blue/teal water from green vegetation, sand, gray roofs and
 * shadows. See plan's threshold-tuning note.
 */
export async function detectWaterMask(image: Buffer): Promise<WaterMask> {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const mask = Buffer.alloc(width * height);
  let waterPixels = 0;
  for (let i = 0; i < width * height; i++) {
    const r = data[i * channels] ?? 0;
    const g = data[i * channels + 1] ?? 0;
    const b = data[i * channels + 2] ?? 0;
    const isWater = b - r >= MIN_BLUE_DOMINANCE && b >= g * MIN_BLUE_GREEN_RATIO;
    if (isWater) {
      mask[i] = 255;
      waterPixels++;
    }
  }
  return { mask, width, height, coverage: waterPixels / (width * height) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mapart/stylize exec vitest run test/water.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/stylize/src/water.ts packages/stylize/test/water.test.ts
git commit -m "feat(stylize): detect water in render via color-based mask"
```

---

### Task 2: Input neutralization (`neutralizeWater` + `waterMaskToPng`)

**Files:**
- Modify: `packages/stylize/src/water.ts`
- Test: `packages/stylize/test/water.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/stylize/test/water.test.ts`:

```ts
import { neutralizeWater, waterMaskToPng } from '../src/water';

/** Read one pixel's [r,g,b] from a PNG buffer. */
async function pixel(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data } = await sharp(buf)
    .removeAlpha()
    .extract({ left: x, top: y, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [data[0] ?? -1, data[1] ?? -1, data[2] ?? -1];
}

describe('neutralizeWater', () => {
  it('blurs a bright speck in water but leaves the land half untouched', async () => {
    // Left half water, right half land, plus a bright-blue speck inside the water
    // half. The speck stays classified as water (blue-dominant) so it sits inside
    // the mask, and the blur should pull its value toward the surrounding water.
    const base = await halfWaterLand(64, 64);
    const speck = await sharp({
      create: { width: 6, height: 6, channels: 3, background: { r: 60, g: 120, b: 220 } },
    })
      .png()
      .toBuffer();
    const img = await sharp(base)
      .composite([{ input: speck, left: 13, top: 29 }])
      .png()
      .toBuffer();

    const out = await neutralizeWater(img);

    // Land half, far from the boundary → identical to the original green.
    expect(await pixel(out, 63, 32)).toEqual([40, 120, 30]);
    // Speck centre in the water half → bright blue pulled down by the blur.
    const [, , b] = await pixel(out, 16, 32);
    expect(b).toBeLessThan(220);
  });
});

describe('waterMaskToPng', () => {
  it('renders the mask as a single-channel PNG of the same size', async () => {
    const img = await halfWaterLand(64, 64);
    const water = await detectWaterMask(img);
    const png = await waterMaskToPng(water);
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(64);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mapart/stylize exec vitest run test/water.test.ts`
Expected: FAIL — `neutralizeWater is not a function` / `waterMaskToPng is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/stylize/src/water.ts`:

```ts
/** Gaussian sigma applied to the water region to kill island-triggering texture. */
export const WATER_BLUR_SIGMA = 8;

/** Sigma the mask is softened by, so the water/coast boundary blends smoothly. */
export const MASK_FEATHER_SIGMA = 6;

/**
 * Return a copy of the render with its water region blurred (texture removed) and
 * the rest untouched. The water mask is feathered so the coastline blends instead
 * of hard-cutting. Pass a precomputed mask to avoid re-detecting.
 */
export async function neutralizeWater(
  image: Buffer,
  water?: WaterMask,
  opts: { blurSigma?: number } = {},
): Promise<Buffer> {
  const { mask, width, height } = water ?? (await detectWaterMask(image));
  const raw = { width, height, channels: 1 as const };

  // Soften the mask edges → used as the alpha of the blurred layer.
  const feathered = await sharp(mask, { raw }).blur(MASK_FEATHER_SIGMA).raw().toBuffer();

  // A fully-blurred copy of the render, masked to water-only via the feathered alpha.
  const blurredWater = await sharp(image)
    .removeAlpha()
    .blur(opts.blurSigma ?? WATER_BLUR_SIGMA)
    .joinChannel(feathered, { raw })
    .png()
    .toBuffer();

  // Lay the masked blur over the original: water gets blurred, land shows through.
  return sharp(image).removeAlpha().composite([{ input: blurredWater }]).png().toBuffer();
}

/** Render a water mask as an inspectable single-channel PNG. */
export function waterMaskToPng(water: WaterMask): Promise<Buffer> {
  return sharp(water.mask, { raw: { width: water.width, height: water.height, channels: 1 } })
    .png()
    .toBuffer();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mapart/stylize exec vitest run test/water.test.ts`
Expected: PASS (4 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/stylize/src/water.ts packages/stylize/test/water.test.ts
git commit -m "feat(stylize): neutralize water texture in render before stylize"
```

---

### Task 3: Export helpers and register the new artifact steps

**Files:**
- Modify: `packages/stylize/src/index.ts`
- Modify: `packages/stylize/src/keys.ts:17`

- [ ] **Step 1: Add the exports**

In `packages/stylize/src/index.ts`, add after the existing `composite` export line:

```ts
export {
  detectWaterMask,
  neutralizeWater,
  waterMaskToPng,
  type WaterMask,
  MIN_BLUE_DOMINANCE,
  MIN_BLUE_GREEN_RATIO,
  WATER_BLUR_SIGMA,
  MASK_FEATHER_SIGMA,
} from './water';
```

- [ ] **Step 2: Register the artifact steps**

In `packages/stylize/src/keys.ts`, replace the `STYLIZE_STEPS` definition (line 17):

```ts
export const STYLIZE_STEPS = ['water-mask', 'neutralized-input', 'composite', 'raw-output'] as const;
```

- [ ] **Step 3: Typecheck the package**

Run: `pnpm --filter @mapart/stylize exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/stylize/src/index.ts packages/stylize/src/keys.ts
git commit -m "feat(stylize): export water helpers and add water-mask/neutralized-input steps"
```

---

### Task 4: Wire neutralization into the stylize consumer

**Files:**
- Modify: `apps/worker-stylize/consumer.ts:13-23` (imports) and `:167-180` (pipeline body)

- [ ] **Step 1: Extend the `@mapart/stylize` import**

In `apps/worker-stylize/consumer.ts`, update the import block (currently lines 16-23) to add the water helpers:

```ts
import {
  STYLIZE_PROMPT,
  type StylizedNeighbors,
  buildComposite,
  detectWaterMask,
  extractStylized,
  neutralizeWater,
  stylizeKey,
  stylizeStepKey,
  waterMaskToPng,
} from '@mapart/stylize';
```

- [ ] **Step 2: Neutralize the render before compositing**

In `apps/worker-stylize/consumer.ts`, replace this line (currently line 167):

```ts
        const { composite, bbox } = await buildComposite(render, ctx.buffers);
```

with:

```ts
        const water = await detectWaterMask(render);
        log(`tile ${at}: water coverage ${(water.coverage * 100).toFixed(1)}%`);
        const neutralized = await neutralizeWater(render, water);
        const { composite, bbox } = await buildComposite(neutralized, ctx.buffers);
```

- [ ] **Step 3: Persist the two new artifacts**

In `apps/worker-stylize/consumer.ts`, replace the artifact-persisting `Promise.all` block (currently lines 177-180):

```ts
        await Promise.all([
          storage.put(stylizeStepKey(tile.projectId, tile.x, tile.y, 'composite'), composite),
          storage.put(stylizeStepKey(tile.projectId, tile.x, tile.y, 'raw-output'), image),
        ]);
```

with:

```ts
        await Promise.all([
          storage.put(
            stylizeStepKey(tile.projectId, tile.x, tile.y, 'water-mask'),
            await waterMaskToPng(water),
          ),
          storage.put(
            stylizeStepKey(tile.projectId, tile.x, tile.y, 'neutralized-input'),
            neutralized,
          ),
          storage.put(stylizeStepKey(tile.projectId, tile.x, tile.y, 'composite'), composite),
          storage.put(stylizeStepKey(tile.projectId, tile.x, tile.y, 'raw-output'), image),
        ]);
```

- [ ] **Step 4: Run the existing consumer tests**

Run: `pnpm --filter @mapart/worker-stylize test`
Expected: PASS — the existing consumer test still passes; neutralization runs transparently on the render buffer.

- [ ] **Step 5: Commit**

```bash
git add apps/worker-stylize/consumer.ts
git commit -m "feat(worker-stylize): neutralize water in render before stylizing"
```

---

### Task 5: Full typecheck and verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck stylize + worker-stylize**

Run: `pnpm --filter @mapart/stylize exec tsc --noEmit && pnpm --filter @mapart/worker-stylize exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the stylize + worker test suites**

Run: `pnpm --filter @mapart/stylize test && pnpm --filter @mapart/worker-stylize test`
Expected: all PASS.

- [ ] **Step 3: Manual smoke (optional, needs a coastline project)**

With the dev stack up (`pnpm dev`), re-stylize a coastline tile and inspect the new artifacts in storage:
`stylize-steps/{projectId}/{x}_{y}/water-mask.png` (water should be white) and
`.../neutralized-input.png` (open water smoothed, land sharp).
If the mask under- or over-covers water on real renders, tune `MIN_BLUE_DOMINANCE` / `MIN_BLUE_GREEN_RATIO` in `packages/stylize/src/water.ts` and re-run.

---

## Notes / Out of Scope

- **Skipping the model on pure-water tiles** (a cost optimization: when `coverage` is ~1.0, fill canonical water and skip the model call) is deliberately deferred. This plan keeps every tile on the same path for simplicity; the blur already removes the hallucination trigger on full-water tiles.
- **Texture-based detection** (local-variance gate) is deferred — the color rule plus the persisted mask artifact is enough to validate and tune the approach first.
- **No DB schema or phase change.** The reviewer/4th-step framing from brainstorming collapses into an in-pipeline input transform, which is simpler and avoids a new queue phase.
</content>
</invoke>
