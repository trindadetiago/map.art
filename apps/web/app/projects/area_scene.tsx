'use client';

import type { LatLng } from '@mapart/geo';
import {
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
  Plane,
  Raycaster,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Scene as ThreeScene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

export type TileState = 'pending' | 'progress' | 'rendered' | 'stylized' | 'error';

/** A tile's footprint state for the Build map. `imageUrl` is set for rendered/stylized. */
export interface OverlayTile {
  x: number;
  y: number;
  state: TileState;
  imageUrl: string | null;
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
function materialFor(state: TileState, texture: Texture | null): MeshBasicMaterial {
  const base = { side: DoubleSide, depthTest: false, depthWrite: false } as const;
  if (texture && state === 'stylized') {
    return new MeshBasicMaterial({ ...base, map: texture });
  }
  if (texture && state === 'rendered') {
    return new MeshBasicMaterial({ ...base, map: texture, transparent: true, opacity: 0.5 });
  }
  const fill = STATE_FILL[state] ?? STATE_FILL.pending;
  return new MeshBasicMaterial({
    ...base,
    color: fill?.color,
    transparent: true,
    opacity: fill?.opacity,
  });
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
  },
  onCenterChange?: (center: LatLng) => void,
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
  const { tiles, reorient } = createTilesRenderer({ apiKey, center: initial.center });
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  // Pan via a parent group, never `tiles.group` directly — the
  // ReorientationPlugin owns `tiles.group`'s transform and `tiles.update()`
  // would clobber a manual offset there.
  const panGroup = new Group();
  panGroup.add(tiles.group);
  scene.add(panGroup);

  let grid = buildGrid(initial.cols, initial.rows);
  scene.add(grid);

  // Finished stylized tiles, textured onto their footprints (build step).
  const overlayGroup = new Group();
  scene.add(overlayGroup);
  const loader = new TextureLoader();
  const overlaid = new Map<
    string,
    { mesh: Mesh; state: TileState; url: string | null; texture: Texture | null }
  >();

  let cols = initial.cols;
  let rows = initial.rows;
  // Zoom multiplier: 1 = grid-fit framing (the most zoomed-out we allow); higher
  // shrinks the ortho frustum to zoom in closer.
  let zoom = 1;
  const MAX_ZOOM = 8;
  // The center we last reoriented to — guards the React effect from re-firing a
  // reorient for a center this scene itself produced.
  let activeCenter: LatLng = initial.center;

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
    camera.position.set(v.dir[0] * v.distance, v.dir[1] * v.distance, v.dir[2] * v.distance);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
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
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.update();
    // Pulse in-progress tiles so active work reads at a glance.
    const now = performance.now();
    const pulse = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(now / 280));
    for (const e of overlaid.values()) {
      if (e.state === 'progress') (e.mesh.material as MeshBasicMaterial).opacity = pulse;
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
    reorientTo(reorient, next);
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

  if (initial.interactive) {
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
  }

  // Scroll to zoom in toward the grid; clamped so it never zooms out past the fit.
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    zoom = Math.min(MAX_ZOOM, Math.max(1, zoom * Math.exp(-e.deltaY * 0.0015)));
    frame();
  };
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

  const clearOverlay = (): void => {
    for (const { mesh, texture } of overlaid.values()) {
      overlayGroup.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      texture?.dispose();
    }
    overlaid.clear();
  };

  const setOverlay = (list: OverlayTile[]): void => {
    for (const t of list) {
      const key = `${t.x},${t.y}`;
      const cur = overlaid.get(key);
      if (cur && cur.state === t.state && cur.url === t.imageUrl) continue; // unchanged

      let texture: Texture | null = null;
      if (t.imageUrl && (t.state === 'rendered' || t.state === 'stylized')) {
        texture = loader.load(t.imageUrl);
        texture.colorSpace = SRGBColorSpace;
      }
      const material = materialFor(t.state, texture);

      if (cur) {
        (cur.mesh.material as MeshBasicMaterial).dispose();
        cur.texture?.dispose();
        cur.mesh.material = material;
        overlaid.set(key, { mesh: cur.mesh, state: t.state, url: t.imageUrl, texture });
      } else {
        const mesh = new Mesh(quadGeometry(t.x, t.y, cols, rows), material);
        mesh.renderOrder = 1000; // above grid lines (999) and streamed tiles
        overlayGroup.add(mesh);
        overlaid.set(key, { mesh, state: t.state, url: t.imageUrl, texture });
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
      scene.remove(grid);
      disposeGrid(grid);
      grid = buildGrid(cols, rows);
      scene.add(grid);
      clearOverlay(); // centering changed — quads must be rebuilt by the caller
      frame();
    },
    recenter(center) {
      if (center.lat === activeCenter.lat && center.lng === activeCenter.lng) return;
      activeCenter = center;
      reorientTo(reorient, center);
      panGroup.position.set(0, 0, 0);
    },
    setOverlay,
    dispose() {
      disposed = true;
      if (settleTimer) clearTimeout(settleTimer);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      clearOverlay();
      scene.remove(grid);
      disposeGrid(grid);
      tiles.dispose();
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
}: AreaSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<SceneState | null>(null);
  // Freeze the construction-time values; later changes flow through effects.
  const initialRef = useRef({ center, cols, rows, interactive, overlay: overlay ?? [] });
  const onCenterChangeRef = useRef(onCenterChange);
  onCenterChangeRef.current = onCenterChange;

  useEffect(() => {
    if (!containerRef.current) return;
    const s = createAreaScene(containerRef.current, apiKey, initialRef.current, (c) =>
      onCenterChangeRef.current?.(c),
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

  return <div ref={containerRef} className="h-full w-full" />;
}
