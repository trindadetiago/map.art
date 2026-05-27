# @mapart/scene

The React `<Scene>` component that mounts a Three.js + Google Photorealistic
3D Tiles renderer into a DOM container. Shared between `apps/web` (interactive
admin + project workspace) and `apps/worker-render/render-page` (the page
headless Chrome navigates to during server-side rendering).

Exports:

- `Scene` — `forwardRef`-wrapped React component
- `SceneHandle` — imperative API exposed via the ref: `capture()`, `isReady()`,
  `waitForSettled({ settleMs, timeoutMs })`
- `SceneProps` — `{ apiKey: string, params: RenderParams }`

Wraps the pure helpers from `@mapart/renderer` (camera math + configured
TilesRenderer) into a React lifecycle.
