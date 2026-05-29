# @mapart/renderer

Three.js + Google Photorealistic 3D Tiles. Ships the React `<Scene>` component
consumed by `apps/web` (the `/admin/renderer` panel) and
`apps/worker-render/render-page` (the page headless Chrome navigates to),
alongside the pure helpers it composes.

React exports (`react` peer dep):

- `Scene` — `forwardRef`-wrapped React component. Mounts a Three.js scene with
  a configured TilesRenderer into a DOM container.
- `SceneHandle` — imperative ref API: `capture()`, `isReady()`,
  `waitForSettled({ settleMs, timeoutMs })`.
- `SceneProps` — `{ apiKey: string, params: RenderParams }`.

Render config + params:

- `RENDER_DEFAULTS` — global render pose & output config: `cameraPitch` 30°,
  `cameraYaw` 45°, `tileWorldMeters` 150, `tilePixelSize` 512. Applied to
  every tile capture.
- `RenderParams` — `{ center: LatLng, pitch, yaw, size, zoom }`. What `<Scene>`
  takes.
- `renderParamsForLatLng(center)` — `RenderParams` for capturing the tile
  centered at `center`, using `RENDER_DEFAULTS`. Zoom picked so the orthographic
  frustum width equals `tileWorldMeters` at that latitude.
- `tileCenterLatLng(center, x, y)` — geographic center of grid tile (x, y)
  given the project's origin tile (0, 0).
- `tileGroundCorners(x, y)` — corners of grid tile (x, y) as east/north meter
  offsets from the origin (for drawing the iso footprint on a map).

Pure helpers (no React, tree-shakable):

- `createTilesRenderer({ apiKey, center })` — returns a `TilesRenderer`
  pre-wired with `GoogleCloudAuthPlugin`, `ReorientationPlugin`,
  `TileCompressionPlugin`, `UpdateOnChangePlugin`. Caller handles
  `setCamera`, the render loop, and disposal.
- `reorientTo(reorient, center)` — re-anchor the scene on a new lat/lng.
- `positionCamera(camera, params)` — yaw/pitch/zoom → orthographic camera
  position.
- `applyFrustum(camera, zoom, lat)` — set ortho frustum from one tile's
  meters at that zoom + latitude.
- `cameraFrustumForZoom(zoom, lat)` — same math as a pure value.

Admin inspector at `/admin/renderer` in `apps/web`.
