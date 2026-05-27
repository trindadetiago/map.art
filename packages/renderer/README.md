# @mapart/renderer

Three.js + Google Photorealistic 3D Tiles. Ships the React `<Scene>` component
consumed by `apps/web` (interactive admin/projects) and
`apps/worker-render/render-page` (the page headless Chrome navigates to),
alongside the pure helpers it composes.

React exports (`react` peer dep):

- `Scene` — `forwardRef`-wrapped React component. Mounts a Three.js scene with
  a configured TilesRenderer into a DOM container.
- `SceneHandle` — imperative ref API: `capture()`, `isReady()`,
  `waitForSettled({ settleMs, timeoutMs })`.
- `SceneProps` — `{ apiKey: string, params: RenderParams }`.

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
