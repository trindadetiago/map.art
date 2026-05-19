'use client';

import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins';
import { TilesRenderer } from '3d-tiles-renderer/three';
import {
  ReorientationPlugin,
  TileCompressionPlugin,
  UpdateOnChangePlugin,
} from '3d-tiles-renderer/three/plugins';
import { type CameraGridParams, tileGroundCorners } from '@mapart/shared';
import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Raycaster,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Scene as ThreeScene,
  Uint32BufferAttribute,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

export type TileVisualState = 'idle' | 'pending' | 'done' | 'error';
const keyOf = (col: number, row: number) => `${col},${row}`;

// RGB triples (0..1) matching the per-state colors used pre-merge.
const STATE_COLORS: Record<TileVisualState, readonly [number, number, number]> = {
  idle: [0x3b / 255, 0x82 / 255, 0xf6 / 255],
  pending: [0xea / 255, 0xb3 / 255, 0x08 / 255],
  done: [0x22 / 255, 0xc5 / 255, 0x5e / 255],
  error: [0xef / 255, 0x44 / 255, 0x44 / 255],
};

export interface TileCoord {
  col: number;
  row: number;
}

export interface ProjectMapProps {
  apiKey: string;
  tiles: TileCoord[];
  centerLat: number;
  centerLng: number;
  pitch: number;
  yaw: number;
  tileWorldMeters: number;
  panX?: number;
  panZ?: number;
  viewZoom?: number;
  height?: number;
  overlay?: React.ReactNode;
  onPanDelta?: (dx: number, dz: number) => void;
  onZoomFactor?: (factor: number) => void;
  onTileClick?: (col: number, row: number) => void;
  /** Fires while the cursor hovers a tile (col=null when leaving / dragging). Coords are
   *  canvas-relative; (x, y) is the projected screen position of the tile's top-right corner.
   *  `screenSize` is the rough on-screen size of the tile in px (longest edge), so callers
   *  can scale or hide UI when the tile is too small to interact with. */
  onTileHover?: (
    col: number | null,
    row: number | null,
    x: number,
    y: number,
    screenSize: number,
  ) => void;
  /** Per-tile visual state keyed by `${col},${row}`. Unlisted tiles render as 'idle'. */
  tileStates?: ReadonlyMap<string, TileVisualState>;
  /** Per-tile image URL keyed by `${col},${row}`. Painted over the colour fill for tiles
   *  that have one (typically generated outputs). Diffed against previous set so existing
   *  textures aren't reloaded when the map changes. */
  tileImages?: ReadonlyMap<string, string>;
}

interface UpdateParams {
  centerLat: number;
  centerLng: number;
  tiles: TileCoord[];
  pitch: number;
  yaw: number;
  tileWorldMeters: number;
  viewZoom: number;
  panX: number;
  panZ: number;
}

interface SceneHandle {
  updateView: (p: UpdateParams) => void;
  setTileStates: (s: ReadonlyMap<string, TileVisualState>) => void;
  setTileImages: (s: ReadonlyMap<string, string>) => void;
  dispose: () => void;
}

export function ProjectMap({
  apiKey,
  tiles,
  centerLat,
  centerLng,
  pitch,
  yaw,
  tileWorldMeters,
  panX = 0,
  panZ = 0,
  viewZoom = 1,
  height = 640,
  overlay,
  onPanDelta,
  onZoomFactor,
  onTileClick,
  onTileHover,
  tileStates,
  tileImages,
}: ProjectMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const initialViewRef = useRef<UpdateParams>({
    centerLat,
    centerLng,
    tiles,
    pitch,
    yaw,
    tileWorldMeters,
    viewZoom,
    panX,
    panZ,
  });
  const onPanRef = useRef(onPanDelta);
  const onZoomRef = useRef(onZoomFactor);
  const onTileClickRef = useRef(onTileClick);
  const onTileHoverRef = useRef(onTileHover);
  useEffect(() => {
    onPanRef.current = onPanDelta;
  });
  useEffect(() => {
    onZoomRef.current = onZoomFactor;
  });
  useEffect(() => {
    onTileClickRef.current = onTileClick;
  });
  useEffect(() => {
    onTileHoverRef.current = onTileHover;
  });

  useEffect(() => {
    if (!containerRef.current || !apiKey || tiles.length === 0) return;
    const initialView = initialViewRef.current;
    const handle = setupScene(containerRef.current, apiKey, initialView, {
      onPanDelta: (dx, dz) => onPanRef.current?.(dx, dz),
      onZoomFactor: (factor) => onZoomRef.current?.(factor),
      onTileClick: (col, row) => onTileClickRef.current?.(col, row),
      onTileHover: (col, row, x, y, s) => onTileHoverRef.current?.(col, row, x, y, s),
    });
    sceneRef.current = handle;
    return () => {
      handle.dispose();
      sceneRef.current = null;
    };
  }, [apiKey, tiles.length]);

  useEffect(() => {
    sceneRef.current?.setTileStates(tileStates ?? new Map());
  }, [tileStates]);

  useEffect(() => {
    sceneRef.current?.setTileImages(tileImages ?? new Map());
  }, [tileImages]);

  useEffect(() => {
    sceneRef.current?.updateView({
      centerLat,
      centerLng,
      tiles,
      pitch,
      yaw,
      tileWorldMeters,
      viewZoom,
      panX,
      panZ,
    });
  }, [centerLat, centerLng, tiles, pitch, yaw, tileWorldMeters, viewZoom, panX, panZ]);

  if (!apiKey) {
    return (
      <div style={{ color: 'crimson', padding: 12 }}>
        <code>GOOGLE_MAPS_API_KEY</code> is not set. Add it to the root <code>.env</code> and
        restart.
      </div>
    );
  }
  if (tiles.length === 0) {
    return <div style={{ opacity: 0.5 }}>no tiles</div>;
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height,
        borderRadius: 4,
        border: '1px solid #ccc',
        overflow: 'hidden',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#0a0a0a' }} />
      {overlay}
    </div>
  );
}

interface InputCallbacks {
  onPanDelta: (dxMeters: number, dzMeters: number) => void;
  onZoomFactor: (factor: number) => void;
  onTileClick: (col: number, row: number) => void;
  onTileHover: (
    col: number | null,
    row: number | null,
    x: number,
    y: number,
    screenSize: number,
  ) => void;
}

function setupScene(
  container: HTMLElement,
  apiKey: string,
  initial: UpdateParams,
  callbacks: InputCallbacks,
): SceneHandle {
  const scene = new ThreeScene();
  scene.add(new AmbientLight(0xffffff, 1.0));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(1, 2, 1);
  scene.add(sun);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth || 800, container.clientHeight || 640, false);
  const canvas = renderer.domElement;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 1e7);

  const tilesRenderer = new TilesRenderer();
  tilesRenderer.registerPlugin(
    new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }),
  );
  const reorient = new ReorientationPlugin({
    lat: (initial.centerLat * Math.PI) / 180,
    lon: (initial.centerLng * Math.PI) / 180,
    height: 0,
    recenter: true,
  });
  tilesRenderer.registerPlugin(reorient);
  tilesRenderer.registerPlugin(new TileCompressionPlugin());
  tilesRenderer.registerPlugin(new UpdateOnChangePlugin());
  tilesRenderer.setCamera(camera);
  tilesRenderer.setResolutionFromRenderer(camera, renderer);
  scene.add(tilesRenderer.group);

  const overlayGroup = new Group();
  scene.add(overlayGroup);

  // Merged overlay: one Mesh (fills) + one LineSegments (outlines), per-tile colour
  // via vertex colour attributes. Rebuilt only when topology (tiles/pitch/yaw/worldM)
  // changes — view-only changes (pan, zoom) skip the rebuild entirely.
  const fillMat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.25,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const outlineMat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
  });
  let fillMesh: Mesh | null = null;
  let outlineMesh: LineSegments | null = null;
  let fillColorsAttr: BufferAttribute | null = null;
  let outlineColorsAttr: BufferAttribute | null = null;
  let tilesArray: TileCoord[] = [];
  const tileIndexMap = new Map<string, number>();
  let lastNonIdleKeys = new Set<string>();
  let topologyKey = '';

  // Per-tile texture meshes for "show generated image on top". Sparse — only
  // tiles with an image have an entry. Diffed against `currentTileImages` so
  // we never reload an unchanged URL.
  const imageGroup = new Group();
  scene.add(imageGroup);
  interface TileImage {
    mesh: Mesh;
    texture: Texture;
    material: MeshBasicMaterial;
    url: string;
  }
  const tileImagesMap = new Map<string, TileImage>();
  const textureLoader = new TextureLoader();
  textureLoader.setCrossOrigin('anonymous');

  let currentExtent = 1000;
  let currentViewZoom = 1;
  let currentPitch = initial.pitch;
  let currentYaw = initial.yaw;
  let currentPanX = 0;
  let currentPanZ = 0;

  function positionCamera(
    pitchDeg: number,
    yawDeg: number,
    frustumSize: number,
    panX: number,
    panZ: number,
  ): void {
    const yawRad = (yawDeg * Math.PI) / 180;
    const pitchRad = (pitchDeg * Math.PI) / 180;
    // Scale camera distance with the visible frustum so the 3D Tiles Renderer's
    // LOD math stays sane at extreme zoom in/out. Floor keeps it above the near
    // plane on huge zoom-ins.
    const distance = Math.max(frustumSize * 8, 200);
    const dx = Math.sin(yawRad) * Math.cos(pitchRad);
    const dy = Math.sin(pitchRad);
    const dz = Math.cos(yawRad) * Math.cos(pitchRad);
    camera.position.set(panX - dx * distance, dy * distance, panZ - dz * distance);
    camera.up.set(0, 1, 0);
    camera.lookAt(panX, 0, panZ);
    camera.updateProjectionMatrix();
  }

  function updateFrustum(frustumSize: number): void {
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 640;
    const a = w / h;
    const hf = frustumSize / 2;
    camera.left = -hf * a;
    camera.right = hf * a;
    camera.top = hf;
    camera.bottom = -hf;
    // Tight near/far around the camera distance so depth precision holds at
    // extreme zoom levels (was hard-coded near=1, far=50k which broke ortho
    // depth when frustum was very small or very large).
    const distance = Math.max(frustumSize * 8, 200);
    camera.near = Math.max(0.1, distance * 0.001);
    camera.far = distance * 10 + frustumSize * 10;
    camera.updateProjectionMatrix();
  }

  function topologyKeyOf(p: UpdateParams): string {
    const n = p.tiles.length;
    const first = n > 0 ? `${p.tiles[0]!.col},${p.tiles[0]!.row}` : '';
    const last = n > 0 ? `${p.tiles[n - 1]!.col},${p.tiles[n - 1]!.row}` : '';
    return `${n}|${first}|${last}|${p.centerLat.toFixed(6)},${p.centerLng.toFixed(6)}|${p.pitch}|${p.yaw}|${p.tileWorldMeters}`;
  }

  function rebuildTopology(params: UpdateParams): void {
    // Drop previous merged geometry.
    if (fillMesh) {
      overlayGroup.remove(fillMesh);
      fillMesh.geometry.dispose();
      fillMesh = null;
    }
    if (outlineMesh) {
      overlayGroup.remove(outlineMesh);
      outlineMesh.geometry.dispose();
      outlineMesh = null;
    }
    tilesArray = params.tiles.slice();
    tileIndexMap.clear();
    for (let i = 0; i < tilesArray.length; i++) {
      const t = tilesArray[i]!;
      tileIndexMap.set(keyOf(t.col, t.row), i);
    }

    reorient.transformLatLonHeightToOrigin(
      (params.centerLat * Math.PI) / 180,
      (params.centerLng * Math.PI) / 180,
      0,
    );

    const n = tilesArray.length;
    if (n === 0) {
      currentExtent = Math.max(params.tileWorldMeters * 2, 1);
      return;
    }

    const gridParams: CameraGridParams = {
      centerLat: params.centerLat,
      centerLng: params.centerLng,
      pitch: params.pitch,
      yaw: params.yaw,
      tileWorldMeters: params.tileWorldMeters,
    };

    // 4 verts per tile × xyz; 6 indices per tile; 8 outline verts per tile (LineSegments).
    const positions = new Float32Array(n * 12);
    const colors = new Float32Array(n * 12);
    const indices = new Uint32Array(n * 6);
    const linePositions = new Float32Array(n * 24);
    const lineColors = new Float32Array(n * 24);

    const idle = STATE_COLORS.idle;
    const lift = 1;
    // ReorientationPlugin sets scene +X = west, +Z = north. tileGroundCorners
    // returns geo meters (east, north), so scene_x = -east, scene_z = +north.
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < n; i++) {
      const t = tilesArray[i]!;
      const c = tileGroundCorners(t.col, t.row, gridParams);
      const nwX = -c.nw.east;
      const nwZ = c.nw.north;
      const neX = -c.ne.east;
      const neZ = c.ne.north;
      const seX = -c.se.east;
      const seZ = c.se.north;
      const swX = -c.sw.east;
      const swZ = c.sw.north;
      if (nwX < minX) minX = nwX;
      if (nwX > maxX) maxX = nwX;
      if (neX < minX) minX = neX;
      if (neX > maxX) maxX = neX;
      if (seX < minX) minX = seX;
      if (seX > maxX) maxX = seX;
      if (swX < minX) minX = swX;
      if (swX > maxX) maxX = swX;
      if (nwZ < minZ) minZ = nwZ;
      if (nwZ > maxZ) maxZ = nwZ;
      if (neZ < minZ) minZ = neZ;
      if (neZ > maxZ) maxZ = neZ;
      if (seZ < minZ) minZ = seZ;
      if (seZ > maxZ) maxZ = seZ;
      if (swZ < minZ) minZ = swZ;
      if (swZ > maxZ) maxZ = swZ;

      const vo = i * 12;
      positions[vo + 0] = nwX;
      positions[vo + 1] = lift;
      positions[vo + 2] = nwZ;
      positions[vo + 3] = neX;
      positions[vo + 4] = lift;
      positions[vo + 5] = neZ;
      positions[vo + 6] = seX;
      positions[vo + 7] = lift;
      positions[vo + 8] = seZ;
      positions[vo + 9] = swX;
      positions[vo + 10] = lift;
      positions[vo + 11] = swZ;

      for (let v = 0; v < 4; v++) {
        const off = vo + v * 3;
        colors[off] = idle[0];
        colors[off + 1] = idle[1];
        colors[off + 2] = idle[2];
      }

      const io = i * 6;
      const base = i * 4;
      indices[io + 0] = base + 0;
      indices[io + 1] = base + 1;
      indices[io + 2] = base + 2;
      indices[io + 3] = base + 0;
      indices[io + 4] = base + 2;
      indices[io + 5] = base + 3;

      // 4 outline segments, 2 verts each, 3 floats per vert = 24 floats per tile.
      const lo = i * 24;
      const seg = (off: number, ax: number, az: number, bx: number, bz: number) => {
        linePositions[lo + off + 0] = ax;
        linePositions[lo + off + 1] = lift;
        linePositions[lo + off + 2] = az;
        linePositions[lo + off + 3] = bx;
        linePositions[lo + off + 4] = lift;
        linePositions[lo + off + 5] = bz;
      };
      seg(0, nwX, nwZ, neX, neZ);
      seg(6, neX, neZ, seX, seZ);
      seg(12, seX, seZ, swX, swZ);
      seg(18, swX, swZ, nwX, nwZ);
      for (let v = 0; v < 8; v++) {
        const off = lo + v * 3;
        lineColors[off] = idle[0];
        lineColors[off + 1] = idle[1];
        lineColors[off + 2] = idle[2];
      }
    }

    const fillGeom = new BufferGeometry();
    fillColorsAttr = new BufferAttribute(colors, 3);
    fillGeom.setAttribute('position', new BufferAttribute(positions, 3));
    fillGeom.setAttribute('color', fillColorsAttr);
    fillGeom.setIndex(new Uint32BufferAttribute(indices, 1));
    fillMesh = new Mesh(fillGeom, fillMat);
    fillMesh.renderOrder = 998;
    fillMesh.frustumCulled = false;
    overlayGroup.add(fillMesh);

    const lineGeom = new BufferGeometry();
    outlineColorsAttr = new BufferAttribute(lineColors, 3);
    lineGeom.setAttribute('position', new BufferAttribute(linePositions, 3));
    lineGeom.setAttribute('color', outlineColorsAttr);
    outlineMesh = new LineSegments(lineGeom, outlineMat);
    outlineMesh.renderOrder = 999;
    outlineMesh.frustumCulled = false;
    overlayGroup.add(outlineMesh);

    // Previous non-idle highlights are irrelevant now — fresh buffer is all-idle.
    lastNonIdleKeys = new Set();

    currentExtent = Math.max(maxX - minX, maxZ - minZ, params.tileWorldMeters * 2);

    // Topology corners changed → reposition every existing image mesh in place.
    for (const [k, img] of tileImagesMap) {
      const i = tileIndexMap.get(k);
      if (i === undefined) {
        imageGroup.remove(img.mesh);
        img.mesh.geometry.dispose();
        if (img.texture) img.texture.dispose();
        img.material.dispose();
        tileImagesMap.delete(k);
        continue;
      }
      updateImageGeometry(img.mesh, i);
    }
  }

  function updateImageGeometry(mesh: Mesh, i: number): void {
    if (!fillMesh) return;
    const fa = (fillMesh.geometry.getAttribute('position') as BufferAttribute)
      .array as Float32Array;
    const vo = i * 12;
    const verts = new Float32Array([
      fa[vo + 0]!,
      fa[vo + 1]!,
      fa[vo + 2]!,
      fa[vo + 3]!,
      fa[vo + 4]!,
      fa[vo + 5]!,
      fa[vo + 6]!,
      fa[vo + 7]!,
      fa[vo + 8]!,
      fa[vo + 9]!,
      fa[vo + 10]!,
      fa[vo + 11]!,
    ]);
    mesh.geometry.dispose();
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(verts, 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    mesh.geometry = g;
  }

  function applyView(params: UpdateParams): void {
    const key = topologyKeyOf(params);
    if (key !== topologyKey) {
      rebuildTopology(params);
      topologyKey = key;
    }
    currentViewZoom = params.viewZoom;
    currentPitch = params.pitch;
    currentYaw = params.yaw;
    currentPanX = params.panX;
    currentPanZ = params.panZ;
    const frustumSize = (currentExtent * 1.15) / params.viewZoom;
    updateFrustum(frustumSize);
    positionCamera(params.pitch, params.yaw, frustumSize, params.panX, params.panZ);
    if (hoveredTile) emitHover();
  }

  const ro = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) return;
    renderer.setSize(w, h, false);
    updateFrustum((currentExtent * 1.15) / currentViewZoom);
  });
  ro.observe(container);

  canvas.style.cursor = 'grab';
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let activePointer: number | null = null;
  const CLICK_PX_THRESHOLD = 5; // squared distance below this treated as a click, not a drag
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const projVec = new Vector3();
  let hoveredTile: { col: number; row: number } | null = null;

  /** Project the 4 corners of a tile to canvas-relative screen coords. Returns the
   *  top-right anchor (visually upper-right in screen space) plus the longest screen
   *  edge so callers can size overlay UI proportionally to the tile. */
  function projectTileScreen(
    col: number,
    row: number,
  ): { x: number; y: number; screenSize: number } | null {
    if (!fillMesh) return null;
    const tileIndex = tileIndexMap.get(keyOf(col, row));
    if (tileIndex === undefined) return null;
    const positions = (fillMesh.geometry.getAttribute('position') as BufferAttribute)
      .array as Float32Array;
    const vo = tileIndex * 12;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestX = 0;
    let bestY = 0;
    let minSx = Number.POSITIVE_INFINITY;
    let maxSx = Number.NEGATIVE_INFINITY;
    let minSy = Number.POSITIVE_INFINITY;
    let maxSy = Number.NEGATIVE_INFINITY;
    for (let v = 0; v < 4; v++) {
      const off = vo + v * 3;
      projVec.set(positions[off]!, positions[off + 1]!, positions[off + 2]!);
      projVec.project(camera);
      const sx = (projVec.x * 0.5 + 0.5) * w;
      const sy = (1 - (projVec.y * 0.5 + 0.5)) * h;
      if (sx < minSx) minSx = sx;
      if (sx > maxSx) maxSx = sx;
      if (sy < minSy) minSy = sy;
      if (sy > maxSy) maxSy = sy;
      const score = sx - sy;
      if (score > bestScore) {
        bestScore = score;
        bestX = sx;
        bestY = sy;
      }
    }
    const screenSize = Math.max(maxSx - minSx, maxSy - minSy);
    return { x: bestX, y: bestY, screenSize };
  }

  function emitHover(): void {
    if (!hoveredTile) {
      callbacks.onTileHover(null, null, 0, 0, 0);
      return;
    }
    const p = projectTileScreen(hoveredTile.col, hoveredTile.row);
    if (!p) return;
    callbacks.onTileHover(hoveredTile.col, hoveredTile.row, p.x, p.y, p.screenSize);
  }

  function clearHover(): void {
    if (!hoveredTile) return;
    hoveredTile = null;
    callbacks.onTileHover(null, null, 0, 0, 0);
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    isDragging = true;
    activePointer = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    downX = e.clientX;
    downY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    clearHover();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging || e.pointerId !== activePointer) {
      if (!isDragging) {
        const rect = canvas.getBoundingClientRect();
        const xCanvas = e.clientX - rect.left;
        const yCanvas = e.clientY - rect.top;
        ndc.x = (xCanvas / rect.width) * 2 - 1;
        ndc.y = -((yCanvas / rect.height) * 2 - 1);
        raycaster.setFromCamera(ndc, camera);
        if (fillMesh) {
          const hits = raycaster.intersectObject(fillMesh, false);
          const first = hits[0];
          if (first && first.faceIndex != null) {
            const tileIndex = Math.floor(first.faceIndex / 2);
            const tile = tilesArray[tileIndex];
            if (tile) {
              hoveredTile = { col: tile.col, row: tile.row };
              emitHover();
              return;
            }
          }
        }
        clearHover();
      }
      return;
    }
    const dpxX = e.clientX - lastX;
    const dpxY = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dpxX === 0 && dpxY === 0) return;

    const canvasH = canvas.clientHeight || 1;
    const frustumHeightWorld = (currentExtent * 1.15) / currentViewZoom;
    const metersPerPx = frustumHeightWorld / canvasH;
    const yawRad = (currentYaw * Math.PI) / 180;
    const pitchRad = (currentPitch * Math.PI) / 180;
    const sinPitch = Math.max(Math.sin(pitchRad), 0.01);

    const rightX = Math.cos(yawRad);
    const rightZ = -Math.sin(yawRad);
    const forwardX = Math.sin(yawRad);
    const forwardZ = Math.cos(yawRad);

    const dragMetersRight = -dpxX * metersPerPx;
    const dragMetersForward = (-dpxY * metersPerPx) / sinPitch;

    const dx = dragMetersRight * rightX + dragMetersForward * forwardX;
    const dz = dragMetersRight * rightZ + dragMetersForward * forwardZ;
    callbacks.onPanDelta(dx, dz);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== activePointer) return;
    isDragging = false;
    activePointer = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore — might have been released by OS on some browsers
    }
    canvas.style.cursor = 'grab';

    // Treat as a click if the pointer barely moved between down and up.
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (dx * dx + dy * dy > CLICK_PX_THRESHOLD * CLICK_PX_THRESHOLD) return;
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(ndc, camera);
    if (!fillMesh) return;
    const hits = raycaster.intersectObject(fillMesh, false);
    const first = hits[0];
    if (!first || first.faceIndex == null) return;
    const tileIndex = Math.floor(first.faceIndex / 2);
    const tile = tilesArray[tileIndex];
    if (tile) callbacks.onTileClick(tile.col, tile.row);
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    callbacks.onZoomFactor(factor);
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });

  applyView(initial);

  let disposed = false;
  const tick = () => {
    if (disposed) return;
    tilesRenderer.setResolutionFromRenderer(camera, renderer);
    tilesRenderer.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  function setTileColor(i: number, c: readonly [number, number, number]): void {
    if (!fillColorsAttr || !outlineColorsAttr) return;
    const fa = fillColorsAttr.array as Float32Array;
    const la = outlineColorsAttr.array as Float32Array;
    const fOff = i * 12;
    for (let v = 0; v < 4; v++) {
      const off = fOff + v * 3;
      fa[off] = c[0];
      fa[off + 1] = c[1];
      fa[off + 2] = c[2];
    }
    const lOff = i * 24;
    for (let v = 0; v < 8; v++) {
      const off = lOff + v * 3;
      la[off] = c[0];
      la[off + 1] = c[1];
      la[off + 2] = c[2];
    }
  }

  return {
    updateView: applyView,
    setTileStates(s) {
      if (!fillColorsAttr || !outlineColorsAttr) return;
      const idle = STATE_COLORS.idle;
      // Reset previously-non-idle tiles that no longer appear in the sparse map.
      for (const k of lastNonIdleKeys) {
        if (s.has(k)) continue;
        const i = tileIndexMap.get(k);
        if (i !== undefined) setTileColor(i, idle);
      }
      // Apply the current non-idle set.
      const nextNonIdle = new Set<string>();
      for (const [k, state] of s) {
        const i = tileIndexMap.get(k);
        if (i === undefined) continue;
        setTileColor(i, STATE_COLORS[state]);
        if (state !== 'idle') nextNonIdle.add(k);
      }
      lastNonIdleKeys = nextNonIdle;
      fillColorsAttr.needsUpdate = true;
      outlineColorsAttr.needsUpdate = true;
    },
    setTileImages(s) {
      // Drop entries gone from the map.
      for (const [k, img] of tileImagesMap) {
        if (s.has(k) && s.get(k) === img.url) continue;
        imageGroup.remove(img.mesh);
        img.mesh.geometry.dispose();
        if (img.texture) img.texture.dispose();
        img.material.dispose();
        tileImagesMap.delete(k);
      }
      // Add / replace entries.
      for (const [k, url] of s) {
        const existing = tileImagesMap.get(k);
        if (existing && existing.url === url) continue;
        const i = tileIndexMap.get(k);
        if (i === undefined) continue; // tile not in current topology
        const material = new MeshBasicMaterial({
          transparent: false,
          depthTest: false,
          depthWrite: false,
          side: DoubleSide,
        });
        const mesh = new Mesh(new BufferGeometry(), material);
        mesh.renderOrder = 1000;
        mesh.frustumCulled = false;
        updateImageGeometry(mesh, i);
        imageGroup.add(mesh);
        // Placeholder entry so a rapid second update doesn't double-load.
        const entry: TileImage = { mesh, texture: undefined as unknown as Texture, material, url };
        tileImagesMap.set(k, entry);
        textureLoader.load(
          url,
          (tex) => {
            // Entry may have been dropped (by a later setTileImages,
            // rebuildTopology, or dispose) before the texture finished
            // loading. In that case the material has already been
            // disposed — throw the texture away instead of leaking it
            // into a dead material.
            if (tileImagesMap.get(k) !== entry) {
              tex.dispose();
              return;
            }
            tex.colorSpace = SRGBColorSpace;
            tex.flipY = true;
            entry.texture = tex;
            material.map = tex;
            material.needsUpdate = true;
          },
          undefined,
          (err) => {
            console.warn(`[map] failed to load tile image ${url}`, err);
            // Bail if our entry is no longer the live one — a later
            // setTileImages (replace or drop) or dispose() already handled
            // cleanup for these resources.
            if (tileImagesMap.get(k) !== entry) return;
            imageGroup.remove(mesh);
            mesh.geometry.dispose();
            material.dispose();
            tileImagesMap.delete(k);
          },
        );
      }
    },
    dispose() {
      disposed = true;
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      if (fillMesh) {
        overlayGroup.remove(fillMesh);
        fillMesh.geometry.dispose();
        fillMesh = null;
      }
      if (outlineMesh) {
        overlayGroup.remove(outlineMesh);
        outlineMesh.geometry.dispose();
        outlineMesh = null;
      }
      overlayGroup.clear();
      for (const img of tileImagesMap.values()) {
        img.mesh.geometry.dispose();
        if (img.texture) img.texture.dispose();
        img.material.dispose();
      }
      tileImagesMap.clear();
      imageGroup.clear();
      tileIndexMap.clear();
      tilesRenderer.dispose();
      renderer.dispose();
      fillMat.dispose();
      outlineMat.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
