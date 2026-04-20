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
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene as ThreeScene,
  Vector3,
  WebGLRenderer,
} from 'three';

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
  useEffect(() => {
    onPanRef.current = onPanDelta;
  });
  useEffect(() => {
    onZoomRef.current = onZoomFactor;
  });

  useEffect(() => {
    if (!containerRef.current || !apiKey || tiles.length === 0) return;
    const initialView = initialViewRef.current;
    const handle = setupScene(containerRef.current, apiKey, initialView, {
      onPanDelta: (dx, dz) => onPanRef.current?.(dx, dz),
      onZoomFactor: (factor) => onZoomRef.current?.(factor),
    });
    sceneRef.current = handle;
    return () => {
      handle.dispose();
      sceneRef.current = null;
    };
  }, [apiKey, tiles.length]);

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

  const outlineMat = new LineBasicMaterial({
    color: 0x3b82f6,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
  });
  const fillMat = new MeshBasicMaterial({
    color: 0x3b82f6,
    transparent: true,
    opacity: 0.18,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  });

  let currentExtent = 1000;
  let currentViewZoom = 1;
  let currentPitch = initial.pitch;
  let currentYaw = initial.yaw;
  let currentPanX = 0;
  let currentPanZ = 0;

  function positionCamera(
    pitchDeg: number,
    yawDeg: number,
    extent: number,
    panX: number,
    panZ: number,
  ): void {
    const yawRad = (yawDeg * Math.PI) / 180;
    const pitchRad = (pitchDeg * Math.PI) / 180;
    const distance = extent * 10;
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
    camera.near = 1;
    camera.far = Math.max(50000, frustumSize * 100);
    camera.updateProjectionMatrix();
  }

  function applyView(params: UpdateParams): void {
    reorient.transformLatLonHeightToOrigin(
      (params.centerLat * Math.PI) / 180,
      (params.centerLng * Math.PI) / 180,
      0,
    );

    const gridParams: CameraGridParams = {
      centerLat: params.centerLat,
      centerLng: params.centerLng,
      pitch: params.pitch,
      yaw: params.yaw,
      tileWorldMeters: params.tileWorldMeters,
    };

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (const child of overlayGroup.children) {
      if (child instanceof Line || child instanceof Mesh) child.geometry.dispose();
    }
    overlayGroup.clear();

    const lift = 1;
    for (const t of params.tiles) {
      const { nw, ne, se, sw } = tileGroundCorners(t.col, t.row, gridParams);
      for (const p of [nw, ne, se, sw]) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
      const fillGeom = new BufferGeometry();
      fillGeom.setAttribute(
        'position',
        new BufferAttribute(
          new Float32Array([
            nw.x,
            lift,
            nw.z,
            ne.x,
            lift,
            ne.z,
            se.x,
            lift,
            se.z,
            sw.x,
            lift,
            sw.z,
          ]),
          3,
        ),
      );
      fillGeom.setIndex([0, 1, 2, 0, 2, 3]);
      const fill = new Mesh(fillGeom, fillMat);
      fill.renderOrder = 998;
      overlayGroup.add(fill);

      const lineGeom = new BufferGeometry().setFromPoints([
        new Vector3(nw.x, lift, nw.z),
        new Vector3(ne.x, lift, ne.z),
        new Vector3(se.x, lift, se.z),
        new Vector3(sw.x, lift, sw.z),
        new Vector3(nw.x, lift, nw.z),
      ]);
      const line = new Line(lineGeom, outlineMat);
      line.renderOrder = 999;
      overlayGroup.add(line);
    }

    const extent = Math.max(maxX - minX, maxZ - minZ, params.tileWorldMeters * 2);
    currentExtent = extent;
    currentViewZoom = params.viewZoom;
    currentPitch = params.pitch;
    currentYaw = params.yaw;
    currentPanX = params.panX;
    currentPanZ = params.panZ;
    updateFrustum((extent * 1.15) / params.viewZoom);
    positionCamera(params.pitch, params.yaw, extent, params.panX, params.panZ);
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
  let activePointer: number | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    isDragging = true;
    activePointer = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging || e.pointerId !== activePointer) return;
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

  return {
    updateView: applyView,
    dispose() {
      disposed = true;
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      for (const child of overlayGroup.children) {
        if (child instanceof Line || child instanceof Mesh) child.geometry.dispose();
      }
      overlayGroup.clear();
      tilesRenderer.dispose();
      renderer.dispose();
      outlineMat.dispose();
      fillMat.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
