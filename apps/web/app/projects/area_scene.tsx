'use client';

import type { LatLng } from '@mapart/geo';
import {
  type ConfiguredTilesRenderer,
  createTilesRenderer,
  gridViewForSize,
  offsetToLatLng,
  reorientTo,
  tileGroundCorners,
} from '@mapart/renderer';
import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Path,
  Plane,
  Raycaster,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  type Texture,
  TextureLoader,
  Scene as ThreeScene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

export type TileState = 'pending' | 'progress' | 'rendered' | 'stylizing' | 'stylized' | 'error';

/** A tile's footprint state for the Build map. `imageUrl` is set for rendered/stylized. */
export interface OverlayTile {
  x: number;
  y: number;
  state: TileState;
  imageUrl: string | null;
  /** Raw render beneath a stylized tile, revealed as the blend slider moves off 1. */
  underUrl?: string | null;
}

export interface AreaSceneProps {
  apiKey: string;
  /** Working grid center. Drives where tiles are reoriented. */
  center: LatLng;
  cols: number;
  rows: number;
  /** When false (view mode) the scene is display-only — no pan/recenter. */
  interactive: boolean;
  /** Fired (debounced) when a pan settles on a new center. */
  onCenterChange?: (center: LatLng) => void;
  /** Stylized tiles painted onto their footprints over the live city. */
  overlay?: OverlayTile[];
  /** Dim everything outside the grid footprint (build view). */
  dimOutside?: boolean;
  /** Draw the per-tile grid outline. Default true. */
  showLines?: boolean;
  /**
   * Stream the Google Photorealistic 3D Tiles backdrop. Default true. When false
   * the renderer is never created (or is torn down), so NO Map Tiles API calls
   * are made — the overlays render on a black background. Used by the Build view
   * to avoid paid API traffic while watching tile progress.
   */
  showMap?: boolean;
  /** Right-click on a tile's footprint (build view). */
  onTileContext?: (x: number, y: number, clientX: number, clientY: number) => void;
  /** Pan + zoom the camera onto this tile. A new object (even same x,y) re-focuses. */
  focusTarget?: { x: number; y: number } | null;
  /**
   * Stylized-layer opacity, 0–1: 1 shows finished tiles fully stylized, 0 shows
   * their raw renders, in between cross-fades the two. Default 1.
   */
  blend?: number;
}

/** Per-tile footprint corners (scene coords) for a grid centered on the origin. */
function buildGrid(cols: number, rows: number): Group {
  const group = new Group();
  const material = new LineBasicMaterial({
    color: 0x0ea5e9,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  });
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const c = tileGroundCorners(i - cx, j - cy);
      // scene frame: +X = west, +Z = north → x = -east, z = north
      const pts = [c.nw, c.ne, c.se, c.sw].map((p) => new Vector3(-p.east, 0, p.north));
      const loop = new LineLoop(new BufferGeometry().setFromPoints(pts), material);
      loop.renderOrder = 999; // float above the streamed 3D tiles
      group.add(loop);
    }
  }
  return group;
}

/** Quad geometry on tile (i,j)'s footprint, centered on the grid origin. */
function quadGeometry(i: number, j: number, cols: number, rows: number): BufferGeometry {
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const c = tileGroundCorners(i - cx, j - cy);
  const v = (p: { east: number; north: number }): number[] => [-p.east, 0, p.north];
  const geo = new BufferGeometry();
  geo.setAttribute(
    'position',
    new Float32BufferAttribute([...v(c.nw), ...v(c.ne), ...v(c.se), ...v(c.sw)], 3),
  );
  // Square image mapped onto the (parallelogram) footprint.
  geo.setAttribute('uv', new Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  return geo;
}

/** Solid status fills for tiles without an image to show. */
const STATE_FILL: Partial<Record<TileState, { color: number; opacity: number }>> = {
  pending: { color: 0x9ca3af, opacity: 0.16 },
  progress: { color: 0xf59e0b, opacity: 0.5 },
  error: { color: 0xdc2626, opacity: 0.5 },
};

/** Material for a tile state: image (full / dimmed) or a translucent status fill. */
function materialFor(state: TileState, texture: Texture | null, blend: number): MeshBasicMaterial {
  const base = { side: DoubleSide, depthTest: false, depthWrite: false } as const;
  if (texture && state === 'stylized') {
    return new MeshBasicMaterial({ ...base, map: texture, transparent: true, opacity: blend });
  }
  if (texture && state === 'rendered') {
    // Un-stylized renders dim toward 0.5 at full blend so they read as "not done
    // yet" next to stylized tiles, and show plain at blend 0 (pure render view).
    return new MeshBasicMaterial({
      ...base,
      map: texture,
      transparent: true,
      opacity: 1 - 0.5 * blend,
    });
  }
  if (texture && state === 'stylizing') {
    // Rendered preview washed amber and pulsed (opacity driven in the tick) so
    // the tile being worked on is obvious.
    return new MeshBasicMaterial({
      ...base,
      map: texture,
      color: 0xffb84d,
      transparent: true,
      opacity: 0.75,
    });
  }
  const fill = STATE_FILL[state] ?? STATE_FILL.pending;
  return new MeshBasicMaterial({
    ...base,
    color: fill?.color,
    transparent: true,
    opacity: fill?.opacity,
  });
}

/**
 * A dark scrim covering the ground with the grid footprint punched out, so
 * everything outside the selected area reads dimmer. Sits above the streamed
 * tiles but below the grid lines + overlay.
 */
function buildMask(cols: number, rows: number): Mesh {
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  // Outer corners of the whole grid, scene coords (x = -east, z = north).
  const sw = tileGroundCorners(0 - cx, 0 - cy).sw;
  const se = tileGroundCorners(cols - 1 - cx, 0 - cy).se;
  const ne = tileGroundCorners(cols - 1 - cx, rows - 1 - cy).ne;
  const nw = tileGroundCorners(0 - cx, rows - 1 - cy).nw;
  // ShapeGeometry lives in XY; rotateX(-90°) maps shape (x, y) → scene (x, 0, -y),
  // so feed (sceneX, -sceneZ).
  const half = gridGroundHalf(cols, rows);
  const R = Math.max(half.x, half.z) * 20 + 1000;
  const shape = new Shape();
  shape.moveTo(-R, R);
  shape.lineTo(R, R);
  shape.lineTo(R, -R);
  shape.lineTo(-R, -R);
  shape.closePath();
  const hole = new Path();
  hole.moveTo(-sw.east, -sw.north);
  hole.lineTo(-se.east, -se.north);
  hole.lineTo(-ne.east, -ne.north);
  hole.lineTo(-nw.east, -nw.north);
  hole.closePath();
  shape.holes.push(hole);
  const mesh = new Mesh(
    new ShapeGeometry(shape),
    new MeshBasicMaterial({
      color: 0x0c0a09,
      transparent: true,
      opacity: 0.6,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  mesh.rotateX(-Math.PI / 2);
  mesh.renderOrder = 500; // over the 3D tiles, under grid lines (999) + overlay (1000)
  return mesh;
}

/** Half-extent of the grid's ground footprint (scene X/Z), for clamping pan. */
function gridGroundHalf(cols: number, rows: number): { x: number; z: number } {
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  let mx = 0;
  let mz = 0;
  for (const [ix, iy] of [
    [0, 0],
    [cols - 1, 0],
    [0, rows - 1],
    [cols - 1, rows - 1],
  ] as const) {
    const c = tileGroundCorners(ix - cx, iy - cy);
    for (const p of [c.nw, c.ne, c.se, c.sw]) {
      mx = Math.max(mx, Math.abs(-p.east));
      mz = Math.max(mz, Math.abs(p.north));
    }
  }
  return { x: mx, z: mz };
}

function disposeGrid(group: Group): void {
  for (const child of group.children) {
    if (child instanceof LineLoop) child.geometry.dispose();
  }
  const mat = (group.children[0] as LineLoop | undefined)?.material;
  if (mat && !Array.isArray(mat)) mat.dispose();
}

interface SceneState {
  setSize: (cols: number, rows: number) => void;
  recenter: (center: LatLng) => void;
  setOverlay: (tiles: OverlayTile[]) => void;
  setDimOutside: (on: boolean) => void;
  setShowLines: (on: boolean) => void;
  setMapVisible: (on: boolean) => void;
  setBlend: (blend: number) => void;
  focusTile: (x: number, y: number) => void;
  dispose: () => void;
}

function createAreaScene(
  container: HTMLElement,
  apiKey: string,
  initial: {
    center: LatLng;
    cols: number;
    rows: number;
    interactive: boolean;
    overlay?: OverlayTile[];
    dimOutside?: boolean;
    showLines?: boolean;
    showMap?: boolean;
    blend?: number;
  },
  onCenterChange?: (center: LatLng) => void,
  onTileContext?: (x: number, y: number, clientX: number, clientY: number) => void,
): SceneState {
  const scene = new ThreeScene();
  scene.add(new AmbientLight(0xffffff, 1.0));
  const sun = new DirectionalLight(0xffffff, 1.5);
  sun.position.set(1, 2, 1);
  scene.add(sun);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const camera = new OrthographicCamera();
  // Pan via a parent group, never `tiles.group` directly — the
  // ReorientationPlugin owns `tiles.group`'s transform and `tiles.update()`
  // would clobber a manual offset there.
  const panGroup = new Group();
  scene.add(panGroup);

  // The Google 3D Tiles renderer is the ONLY thing here that hits the paid Map
  // Tiles API. It's created lazily and disposed when hidden, so a Build view
  // with the map hidden issues zero API calls until the map is turned on.
  let tilesState: ConfiguredTilesRenderer | null = null;

  let grid = buildGrid(initial.cols, initial.rows);
  grid.visible = initial.showLines ?? true;
  scene.add(grid);

  let mask = buildMask(initial.cols, initial.rows);
  mask.visible = initial.dimOutside ?? false;
  scene.add(mask);

  // Finished stylized tiles, textured onto their footprints (build step). A
  // stylized tile may carry a second quad underneath with its raw render; the
  // blend value fades the stylized layer over it.
  const overlayGroup = new Group();
  scene.add(overlayGroup);
  const loader = new TextureLoader();
  let blend = Math.max(0, Math.min(1, initial.blend ?? 1));
  const overlaid = new Map<
    string,
    {
      mesh: Mesh;
      under: Mesh | null;
      state: TileState;
      url: string | null;
      underUrl: string | null;
      texture: Texture | null;
      underTexture: Texture | null;
    }
  >();

  let cols = initial.cols;
  let rows = initial.rows;
  // Zoom multiplier: 1 = grid-fit framing (the most zoomed-out we allow); higher
  // shrinks the ortho frustum to zoom in closer. The cap scales with the grid so
  // you can always zoom past a single tile — on a 200-wide grid, fit-of-one-tile
  // is ~200x, so 8x would never reach it.
  let zoom = 1;
  const maxZoom = (): number => Math.max(8, Math.max(cols, rows) * 2);
  // Camera target offset on the ground (scene X/Z) for panning within the grid.
  let panX = 0;
  let panZ = 0;
  let gridHalf = gridGroundHalf(initial.cols, initial.rows);
  // The center we last reoriented to — guards the React effect from re-firing a
  // reorient for a center this scene itself produced.
  let activeCenter: LatLng = initial.center;

  // Lazily attach/detach the streamed Google 3D Tiles. Attaching starts the only
  // billable Map Tiles API traffic; detaching disposes the session entirely.
  const createTiles = (): void => {
    if (tilesState) return;
    tilesState = createTilesRenderer({ apiKey, center: activeCenter });
    tilesState.tiles.setCamera(camera);
    tilesState.tiles.setResolutionFromRenderer(camera, renderer);
    panGroup.add(tilesState.tiles.group);
  };
  const destroyTiles = (): void => {
    if (!tilesState) return;
    panGroup.remove(tilesState.tiles.group);
    tilesState.tiles.dispose();
    tilesState = null;
  };
  if (initial.showMap ?? true) createTiles();

  // Keep the pan target inside the grid: at fit (zoom 1) it's locked to center;
  // the deeper the zoom, the further it may roam, up to the grid half-extent.
  const clampPan = (): void => {
    const k = Math.max(0, 1 - 1 / zoom);
    const mx = gridHalf.x * k;
    const mz = gridHalf.z * k;
    panX = Math.max(-mx, Math.min(mx, panX));
    panZ = Math.max(-mz, Math.min(mz, panZ));
  };

  // Frame the whole grid in the ortho iso pose, fit to the canvas aspect.
  const frame = (): void => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    const aspect = w / h;
    const v = gridViewForSize(cols, rows);
    let halfW = v.halfW;
    let halfH = v.halfH;
    if (halfW / halfH < aspect) halfW = halfH * aspect;
    else halfH = halfW / aspect;
    halfW /= zoom;
    halfH /= zoom;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.near = v.near;
    camera.far = v.far;
    camera.position.set(
      panX + v.dir[0] * v.distance,
      v.dir[1] * v.distance,
      panZ + v.dir[2] * v.distance,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(panX, 0, panZ);
    camera.updateProjectionMatrix();
  };

  const resize = (): void => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    frame();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  let disposed = false;
  const tick = (): void => {
    if (disposed) return;
    if (tilesState) {
      tilesState.tiles.setResolutionFromRenderer(camera, renderer);
      tilesState.tiles.update();
    }
    // Pulse in-progress tiles so active work reads at a glance.
    const now = performance.now();
    const pulse = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(now / 280));
    for (const e of overlaid.values()) {
      if (e.state === 'progress' || e.state === 'stylizing') {
        (e.mesh.material as MeshBasicMaterial).opacity = pulse;
      }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // --- pan-to-recenter (drag the map under a fixed center crosshair) --------
  const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  const raycaster = new Raycaster();
  const ndc = new Vector2();

  /** World point where the pointer ray meets the ground plane (y = 0). */
  const groundAt = (clientX: number, clientY: number): Vector3 | null => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    const hit = new Vector3();
    return raycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
  };

  let dragStart: Vector3 | null = null;
  let basePos: Vector3 | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  const bakeRecenter = (): void => {
    // The geographic point now under the (fixed) scene origin sits at
    // -panGroup.position in the pre-drag tile frame; convert that meter offset
    // back to a lat/lng. scene +X = west, +Z = north → east = x, north = -z.
    const east = panGroup.position.x;
    const north = -panGroup.position.z;
    if (east === 0 && north === 0) return;
    const next = offsetToLatLng(activeCenter, east, north);
    activeCenter = next;
    if (tilesState) reorientTo(tilesState.reorient, next);
    panGroup.position.set(0, 0, 0);
    onCenterChange?.(next);
  };

  const onPointerDown = (e: PointerEvent): void => {
    const p = groundAt(e.clientX, e.clientY);
    if (!p) return;
    dragStart = p;
    basePos = panGroup.position.clone();
    renderer.domElement.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!dragStart || !basePos) return;
    const p = groundAt(e.clientX, e.clientY);
    if (!p) return;
    panGroup.position.set(
      basePos.x + (p.x - dragStart.x),
      basePos.y,
      basePos.z + (p.z - dragStart.z),
    );
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (!dragStart) return;
    dragStart = null;
    basePos = null;
    renderer.domElement.releasePointerCapture(e.pointerId);
    // Debounce the (re-streaming) reorient until the drag has settled.
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(bakeRecenter, 400);
  };

  // Drag-to-pan within the grid (view/build mode). The grabbed ground point
  // stays under the cursor; the camera target shifts, clamped to the grid.
  let grab: Vector3 | null = null;
  const onPanDown = (e: PointerEvent): void => {
    grab = groundAt(e.clientX, e.clientY);
    if (grab) renderer.domElement.setPointerCapture(e.pointerId);
  };
  const onPanMove = (e: PointerEvent): void => {
    if (!grab) return;
    const cur = groundAt(e.clientX, e.clientY);
    if (!cur) return;
    panX += grab.x - cur.x;
    panZ += grab.z - cur.z;
    clampPan();
    frame();
  };
  const onPanUp = (e: PointerEvent): void => {
    if (!grab) return;
    grab = null;
    renderer.domElement.releasePointerCapture(e.pointerId);
  };

  if (initial.interactive) {
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
  } else {
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.addEventListener('pointerdown', onPanDown);
    renderer.domElement.addEventListener('pointermove', onPanMove);
    renderer.domElement.addEventListener('pointerup', onPanUp);
  }

  // Scroll to zoom in toward the grid; clamped so it never zooms out past the fit.
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    zoom = Math.min(maxZoom(), Math.max(1, zoom * Math.exp(-e.deltaY * 0.0015)));
    clampPan(); // zooming out shrinks the pan range
    frame();
  };
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

  // Right-click a tile's footprint → report which tile (build view).
  const onContextMenu = (e: MouseEvent): void => {
    if (!onTileContext) return;
    e.preventDefault();
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(overlayGroup.children, false)[0];
    const tile = hit?.object.userData.tile as { x: number; y: number } | undefined;
    if (tile) onTileContext(tile.x, tile.y, e.clientX, e.clientY);
  };
  if (onTileContext) renderer.domElement.addEventListener('contextmenu', onContextMenu);

  const removeUnder = (e: { under: Mesh | null; underTexture: Texture | null }): void => {
    if (!e.under) return;
    overlayGroup.remove(e.under);
    e.under.geometry.dispose();
    (e.under.material as MeshBasicMaterial).dispose();
    e.underTexture?.dispose();
  };

  const clearOverlay = (): void => {
    for (const e of overlaid.values()) {
      overlayGroup.remove(e.mesh);
      e.mesh.geometry.dispose();
      (e.mesh.material as MeshBasicMaterial).dispose();
      e.texture?.dispose();
      removeUnder(e);
    }
    overlaid.clear();
  };

  const setOverlay = (list: OverlayTile[]): void => {
    for (const t of list) {
      const key = `${t.x},${t.y}`;
      const underUrl = t.underUrl ?? null;
      const cur = overlaid.get(key);
      if (cur && cur.state === t.state && cur.url === t.imageUrl && cur.underUrl === underUrl)
        continue; // unchanged

      let texture: Texture | null = null;
      if (
        t.imageUrl &&
        (t.state === 'rendered' || t.state === 'stylizing' || t.state === 'stylized')
      ) {
        texture = loader.load(t.imageUrl);
        texture.colorSpace = SRGBColorSpace;
      }
      const material = materialFor(t.state, texture, blend);

      let mesh: Mesh;
      if (cur) {
        (cur.mesh.material as MeshBasicMaterial).dispose();
        cur.texture?.dispose();
        removeUnder(cur); // rebuilt below if the tile still wants one
        cur.mesh.material = material;
        mesh = cur.mesh;
      } else {
        mesh = new Mesh(quadGeometry(t.x, t.y, cols, rows), material);
        mesh.renderOrder = 1001; // above the under layer (1000) and grid lines (999)
        mesh.userData.tile = { x: t.x, y: t.y };
        overlayGroup.add(mesh);
      }
      mesh.visible = t.state !== 'stylized' || blend > 0;

      // Raw render beneath a stylized tile. Its texture loads lazily on the
      // first blend < 1, so the default stylized view downloads nothing extra.
      let under: Mesh | null = null;
      let underTexture: Texture | null = null;
      if (underUrl && t.state === 'stylized') {
        const m = new MeshBasicMaterial({ side: DoubleSide, depthTest: false, depthWrite: false });
        if (blend < 1) {
          underTexture = loader.load(underUrl);
          underTexture.colorSpace = SRGBColorSpace;
          m.map = underTexture;
        }
        under = new Mesh(quadGeometry(t.x, t.y, cols, rows), m);
        under.renderOrder = 1000;
        under.userData.tile = { x: t.x, y: t.y };
        under.visible = blend < 1;
        overlayGroup.add(under);
      }

      overlaid.set(key, {
        mesh,
        under,
        state: t.state,
        url: t.imageUrl,
        underUrl,
        texture,
        underTexture,
      });
    }
  };

  const setBlend = (value: number): void => {
    blend = Math.max(0, Math.min(1, value));
    for (const e of overlaid.values()) {
      if (e.state === 'stylized') {
        (e.mesh.material as MeshBasicMaterial).opacity = blend;
        e.mesh.visible = blend > 0;
      } else if (e.state === 'rendered') {
        (e.mesh.material as MeshBasicMaterial).opacity = 1 - 0.5 * blend;
      }
      if (e.under) {
        e.under.visible = blend < 1;
        if (blend < 1 && e.underUrl && !e.underTexture) {
          e.underTexture = loader.load(e.underUrl);
          e.underTexture.colorSpace = SRGBColorSpace;
          const m = e.under.material as MeshBasicMaterial;
          m.map = e.underTexture;
          m.needsUpdate = true;
        }
      }
    }
  };

  setOverlay(initial.overlay ?? []);

  return {
    setSize(nextCols, nextRows) {
      if (nextCols === cols && nextRows === rows) return;
      cols = nextCols;
      rows = nextRows;
      zoom = 1; // refit the resized grid
      panX = 0;
      panZ = 0;
      gridHalf = gridGroundHalf(cols, rows);
      const linesVisible = grid.visible;
      const dimVisible = mask.visible;
      scene.remove(grid);
      disposeGrid(grid);
      grid = buildGrid(cols, rows);
      grid.visible = linesVisible;
      scene.add(grid);
      scene.remove(mask);
      mask.geometry.dispose();
      (mask.material as MeshBasicMaterial).dispose();
      mask = buildMask(cols, rows);
      mask.visible = dimVisible;
      scene.add(mask);
      clearOverlay(); // centering changed — quads must be rebuilt by the caller
      frame();
    },
    recenter(center) {
      if (center.lat === activeCenter.lat && center.lng === activeCenter.lng) return;
      activeCenter = center;
      if (tilesState) reorientTo(tilesState.reorient, center);
      panGroup.position.set(0, 0, 0);
    },
    setOverlay,
    setBlend,
    setMapVisible(on) {
      if (on) createTiles();
      else destroyTiles();
    },
    focusTile(x, y) {
      // Pan the camera target onto tile (x,y)'s footprint center and zoom in so
      // it sits framed with a few neighbours of context around it.
      const cx = (cols - 1) / 2;
      const cy = (rows - 1) / 2;
      const c = tileGroundCorners(x - cx, y - cy);
      let ex = 0;
      let ez = 0;
      for (const p of [c.nw, c.ne, c.se, c.sw]) {
        ex += -p.east;
        ez += p.north;
      }
      panX = ex / 4;
      panZ = ez / 4;
      zoom = Math.min(maxZoom(), Math.max(4, Math.max(cols, rows) / 6));
      clampPan();
      frame();
    },
    setDimOutside(on) {
      mask.visible = on;
    },
    setShowLines(on) {
      grid.visible = on;
    },
    dispose() {
      disposed = true;
      if (settleTimer) clearTimeout(settleTimer);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointerdown', onPanDown);
      renderer.domElement.removeEventListener('pointermove', onPanMove);
      renderer.domElement.removeEventListener('pointerup', onPanUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      clearOverlay();
      scene.remove(grid);
      disposeGrid(grid);
      scene.remove(mask);
      mask.geometry.dispose();
      (mask.material as MeshBasicMaterial).dispose();
      destroyTiles();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}

export function AreaScene({
  apiKey,
  center,
  cols,
  rows,
  interactive,
  onCenterChange,
  overlay,
  dimOutside,
  showLines,
  showMap,
  onTileContext,
  focusTarget,
  blend,
}: AreaSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<SceneState | null>(null);
  // Freeze the construction-time values; later changes flow through effects.
  const initialRef = useRef({
    center,
    cols,
    rows,
    interactive,
    overlay: overlay ?? [],
    dimOutside: dimOutside ?? false,
    showLines: showLines ?? true,
    showMap: showMap ?? true,
    blend: blend ?? 1,
  });
  const onCenterChangeRef = useRef(onCenterChange);
  onCenterChangeRef.current = onCenterChange;
  const onTileContextRef = useRef(onTileContext);
  onTileContextRef.current = onTileContext;

  useEffect(() => {
    if (!containerRef.current) return;
    const s = createAreaScene(
      containerRef.current,
      apiKey,
      initialRef.current,
      (c) => onCenterChangeRef.current?.(c),
      onTileContextRef.current
        ? (x, y, cx, cy) => onTileContextRef.current?.(x, y, cx, cy)
        : undefined,
    );
    stateRef.current = s;
    return () => {
      s.dispose();
      stateRef.current = null;
    };
  }, [apiKey]);

  useEffect(() => {
    stateRef.current?.setSize(cols, rows);
  }, [cols, rows]);

  useEffect(() => {
    stateRef.current?.recenter(center);
  }, [center]);

  useEffect(() => {
    if (overlay) stateRef.current?.setOverlay(overlay);
  }, [overlay]);

  useEffect(() => {
    stateRef.current?.setDimOutside(dimOutside ?? false);
  }, [dimOutside]);

  useEffect(() => {
    stateRef.current?.setShowLines(showLines ?? true);
  }, [showLines]);

  useEffect(() => {
    stateRef.current?.setMapVisible(showMap ?? true);
  }, [showMap]);

  useEffect(() => {
    stateRef.current?.setBlend(blend ?? 1);
  }, [blend]);

  useEffect(() => {
    if (focusTarget) stateRef.current?.focusTile(focusTarget.x, focusTarget.y);
  }, [focusTarget]);

  return <div ref={containerRef} className="h-full w-full" />;
}
