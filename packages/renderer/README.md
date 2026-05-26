# @mapart/renderer

Tile renderer. Three.js scene streaming Google Photorealistic 3D Tiles → captures the canvas as a PNG.

- Input: camera params (lat/lng, pitch, yaw, zoom, size)
- Output: PNG buffer
- Server-side `renderTile()` is currently a stub; real rendering happens client-side via the `<Scene>` component (now lives in `apps/web/components/Scene.tsx`).
- Admin inspector at `/admin/renderer` in `apps/web`
- CLI entry: `pnpm mapart renderer render --lat … --lng … --out …` (stub output for now)
