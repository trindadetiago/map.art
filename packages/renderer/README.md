# @mapart/renderer

Shared Three.js + Google Photorealistic 3D Tiles helpers. No DOM, no React — just
the bits that are useful in both the browser (via `<Scene>` in `apps/web`) and
a future headless worker.

- `createTilesRenderer({ apiKey, center })` — returns a `TilesRenderer` pre-wired
  with `GoogleCloudAuthPlugin`, `ReorientationPlugin`, `TileCompressionPlugin`,
  and `UpdateOnChangePlugin`. Caller handles `setCamera`, the render loop, and disposal.
- `reorientTo(reorient, center)` — re-anchor the scene when the user pans.
- `positionCamera(camera, params)` — yaw/pitch/zoom → orthographic camera position.
- `applyFrustum(camera, zoom, lat)` — set ortho left/right/top/bottom/near/far from
  one tile's worth of meters at that zoom + latitude.
- `cameraFrustumForZoom(zoom, lat)` — same math as a pure value.

Consumed today by `apps/web/components/scene.tsx`. Admin inspector at `/admin/renderer`.
