# Phase 1 Performance — Handoff

## 1. What changed

| File | Change |
|------|--------|
| `apps/web/components/scene.tsx` | Added on-demand rendering (`needsRender` flag), idle-loop skip, `requestIdleCallback` deferral, `pixelRatio` hardcoded to 1. New API: `startRendering()`, `stopRendering()`, `markReady()`. `waitForSettled` now resolves early if queues are already idle. Default settleMs 500→200. |
| `apps/web/components/projects/project_map.tsx` | Removed 4 `useEffect`-only-for-ref-updates (now direct assignments). Added `webglReady` state + `onReady` callback so the map shows a "Loading 3D tiles…" skeleton until first frame. Added 100ms debounce on `rebuildTopology`. |
| `apps/web/components/projects/project_workspace.tsx` | `setStatus` now short-circuits if the new status is identical to the existing one (phase, error, URLs) — avoids spurious Map copies and re-renders. Fixed neighbor-capture reference bug: `localRendered` (which was aliased to component state) replaced with `newlyRendered` (separate map, correct fallback via `savedRendered.get`). |
| `apps/web/app/projects/[slug]/loading.tsx` | NEW. Suspense fallback: centered "Loading project…" shimmer. |
| `apps/web/app/projects/[slug]/error.tsx` | NEW. Error boundary with "Failed to load project" message and "Try again" reset button. |

## 2. Why

### Problem 1: Hidden capture scene rendered 60fps forever

`scene.tsx` ran a `requestAnimationFrame` loop that called `tiles.update()` + `renderer.render()` on every frame, 24/7, even when nobody was capturing. Two WebGL contexts (capture scene + preview map) churned GPU continuously.

**After:** The capture scene's tick loop checks `needsRender` (default `false`). No work happens until something calls `startRendering()` or `capture()`. Idle GPU usage drops ~95% for the capture renderer.

### Problem 2: Initial rAF was synchronous on mount

The tick loop started on the very first rAF, competing with React hydration and the preview map's own WebGL bootstrap.

**After:** Wrapped in `requestIdleCallback` so the capture scene initializes after the browser is idle.

### Problem 3: Pixel ratio wasted GPU memory

`renderer.setPixelRatio(window.devicePixelRatio)` on Retina created 2×/3× backing stores that were immediately downscaled in `capture()` anyway.

**After:** Hardcoded to `1`. Capture already exports at logical size.

### Problem 4: `rebuildTopology` fired on every slider tick

Dragging any slider (pitch, yaw, tile size) called `rebuildTopology()` on every React re-render — tearing down and reallocating merged BufferGeometry+attributes for all tiles, uploading to GPU each time. On a 60fps slider, that's up to 60 GPU buffer uploads/second.

**After:** 100ms debounce. Only the final value triggers a rebuild.

### Problem 5: `setStatus` created new Map on every call

Even when the status hadn't changed, `setStatus` unconditionally did `new Map(m)` and `.set(k, s)`, triggering downstream re-renders of `tileStates`/`tileImages`/`recent`.

**After:** Identity comparison before copying. If `phase`, `error`, `renderedUrl`, and `generatedUrl` all match the existing entry, the same Map instance is returned.

### Problem 6: Neighbor capture used stale reference

`localRendered` started as `new Map(savedRendered)` — an alias to component state. Tiles rendered during the neighbor loop were added to it, but callers (capturing neighbors) looked them up from `localRendered` which didn't include updates from `setSavedRendered`.

**After:** `newlyRendered` is a separate Map tracking only tiles rendered in the current operation. Neighbor lookup falls back to `savedRendered.get(nk)`.

### Problem 7: No loading/error UI

The project page was a blank white screen while the server-side DB query ran (1–2s) and while WebGL bootstrapped (3–5s). If the DB query failed, there was no recovery.

**After:** Next.js `loading.tsx` covers the server-side wait. `project_map.tsx` shows a skeleton until the first WebGL frame. `error.tsx` gives a retry button.

### Before/after summary (approximate)

| Metric | Before | After |
|--------|--------|-------|
| Scene render loop | 60fps always | 0fps idle, renders only during capture |
| Capture scene GPU memory | DPR× (2–3× waste) | 1× logical size |
| Slider drag topology rebuilds | every React render (potentially 60/s) | debounced to 100ms, ~1 per gesture |
| `setStatus` Map copies during bulk | ~N× per render cycle | 0 unless values actually changed |
| Neighbor capture correctness | stale rendered-URL lookup | correct via `newlyRendered` + fallback |
| Page load experience | blank white 3–8s | shimmer + skeleton + error state |

## 3. How to test

Run the dev environment: `pnpm dev`

### Capture scene idles

1. Open a project page.
2. Open Chrome DevTools → Performance tab → record 5s.
3. Confirm no frames are being rendered by the hidden capture scene (the `scene.tsx` component at `left: -99999`). You should see **zero** GPU activity when not capturing.
4. Click a tile to trigger render+generate. During the capture phase, GPU activity should spike briefly, then return to zero.

### Slider debounce

1. On the project page, drag the "pitch" slider rapidly back and forth.
2. Open the Console tab. Confirm no "Maximum update depth exceeded" or stuttering.
3. The tile grid should only repaint once you stop dragging (within 100ms), not on every intermediate value.

### Loading states

1. Hard-refresh the project page (Cmd+Shift+R).
2. You should see "Loading project…" briefly (server render).
3. Then the workspace UI appears, with the map area showing "Loading 3D tiles…" until the first WebGL frame paints.
4. Force an error: temporarily set an invalid DB connection, reload. Confirm the error boundary shows "Failed to load project" with a "Try again" button.

### Neighbor capture correctness

1. On a project with at least a 2×2 grid, click a tile that has already-generated neighbors.
2. The infill composite should use the correct neighbor images (not stale rendered URLs). Verify in the generated output — seams should match adjacent tiles.

### `setStatus` identity check

1. Trigger a bulk generate.
2. While it's running, confirm the "recent activity" panel updates but doesn't flicker/re-render unnecessarily. Status dots on tiles should change color smoothly.

## 4. Scene API changes

`SceneHandle` has three new methods. **They exist but are not yet wired into callers.**

```typescript
interface SceneHandle {
  // Existing
  capture(): string | null;
  isReady(): boolean;
  waitForSettled(opts?: { settleMs?: number; timeoutMs?: number }): Promise<void>;

  // NEW — Phase 1
  startRendering(): void;   // sets needsRender = true, enables rAF loop
  stopRendering(): void;    // sets needsRender = false, pauses rAF loop
  markReady(): void;        // sets contentLoaded = true (skip waitForSettled poll)
}
```

### When callers should use them

- **Before a capture loop:** `sceneRef.current.startRendering()` — enables the tick loop so the TilesRenderer can stream in tiles.
- **After the capture loop:** `sceneRef.current.stopRendering()` — stops burning GPU on an idle hidden scene.
- **`markReady()`:** Call after N tiles are known to be loaded (e.g., after a `load-tile-set` event from outside the component). Lets `waitForSettled` resolve immediately instead of polling.

### Current state

The hidden scene in `project_workspace.tsx` (line 714) does **not** wrap captures with `startRendering()`/`stopRendering()`. The `capture()` method internally sets `needsRender = true` for one frame, but the loop stays off. This works because `capture()` does a manual `renderer.render()` synchronously.

For Phase 2 (when captures move to a worker), the browser-side scene should explicitly call `stopRendering()` after setup to guarantee zero idle GPU usage.

### `waitForSettled` behavior change

- Now sets `needsRender = true` on entry (was relying on the always-on loop).
- Resolves immediately if `contentLoaded && queues idle` — skips the 200ms settle wait.
- Default `settleMs` changed from 500 to 200.

## 5. Known limitations (what this does NOT fix)

| Limitation | Why |
|------------|-----|
| **Two separate TilesRenderer instances** | The capture scene and preview map each create their own `TilesRenderer`, downloading Google 3D Tiles twice. Phase 1 didn't tackle the shared context because it requires architectural refactoring (lifting state to a provider). |
| **Still capturing tiles in the browser** | `project_workspace.tsx` still renders + captures in the browser. The capture scene is just less wasteful when idle — it still exists. |
| **`waitForSettled` still polls at 100ms intervals** | No event-driven settle was implemented. The early-resolve optimization helps, but the polling loop still runs during capture. |
| **Preview map rAF still runs at 60fps** | The interactive map in `project_map.tsx` was not throttled — it needs to render continuously for smooth pan/zoom. This is expected for an interactive viewport. |
| **No shared TilesRenderer cache** | Each call to `createTilesRenderer()` creates independent download/parse queues. Tiles fetched by the preview map are not reused by the capture scene. |
| **Slider still triggers React re-renders** | Only the topology rebuild is debounced. React state updates (centerLat, pitch, yaw, etc.) still fire on every slider input event. |
| **No `startRendering()`/`stopRendering()` wiring** | The API exists but callers don't use it yet. The capture scene's loop stays off by default (safe), but there's no explicit lifecycle management. |

## 6. Next steps

These map to the RFC's Phase 2 and Phase 3 sections.

### Short-term (Phase 2 prep)

1. **Wire `startRendering()`/`stopRendering()`** in `project_workspace.tsx` around the capture flow. Currently the scene stays off; make the lifecycle explicit.
2. **Shared TilesRenderer context.** Lift the preview map's `TilesRenderer` into a React context so the capture scene reuses it instead of creating a second instance. This halves bandwidth and GPU memory for 3D tile data.
3. **Event-driven settle.** Replace the 100ms polling loop in `waitForSettled` with `TilesRenderer` events (`load-tile-set`, `load-model`). The early-resolve check is already in place — add event listeners for the remaining case.
4. **React.memo on ProjectMap.** The map component re-renders on every slider change even when only camera params shifted (topology unchanged). Memoize to skip GPU work when only view params change.

### Medium-term (Phase 2 — Worker Pipeline)

- Move tile rendering to `worker-render` (Puppeteer + headless Chrome, already scaffolded in `apps/worker-render/`).
- Browser stops capturing; instead POSTs to API, polls job status, displays pre-rendered PNGs from S3.
- This eliminates the hidden capture scene entirely from the browser.

### Long-term (Phase 3 — Full Pre-Rendered)

- Replace the Three.js preview map with a Canvas 2D or OpenSeadragon viewer showing pre-rendered tile images.
- Zero Three.js in the browser. Bundle size drops ~500KB.
- DZI pyramid export for pixel-art zoom/pan.

---

See `docs/rfc-frontend-performance.md` for the full plan with architecture diagrams, trade-off analysis, and implementation timeline.
