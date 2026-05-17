'use client';

import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins';
import { TilesRenderer } from '3d-tiles-renderer/three';
import {
  ReorientationPlugin,
  TileCompressionPlugin,
  UpdateOnChangePlugin,
} from '3d-tiles-renderer/three/plugins';
import { type RenderParams, tileWidthMeters } from '@mapart/shared';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  AmbientLight,
  DirectionalLight,
  OrthographicCamera,
  Scene as ThreeScene,
  WebGLRenderer,
} from 'three';

export interface SceneHandle {
  capture: () => string | null;
  isReady: () => boolean;
  /**
   * Resolves once the TilesRenderer's download + parse queues have been idle
   * for `settleMs` (default 500ms), or rejects after `timeoutMs`
   * (default 15000ms). Useful for automated capture loops that need to wait
   * for streaming to quiesce before grabbing a frame.
   */
  waitForSettled: (opts?: { settleMs?: number; timeoutMs?: number }) => Promise<void>;
}

export interface SceneProps {
  apiKey: string;
  params: RenderParams;
}

export const Scene = forwardRef<SceneHandle, SceneProps>(function Scene({ apiKey, params }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const state = useRef<SceneState | null>(null);
  const initialParamsRef = useRef(params);

  useEffect(() => {
    if (!containerRef.current) return;
    const s = createScene(containerRef.current, apiKey, initialParamsRef.current);
    state.current = s;
    return () => {
      s.dispose();
      state.current = null;
    };
  }, [apiKey]);

  useEffect(() => {
    state.current?.updateParams(params);
  }, [params]);

  useImperativeHandle(
    ref,
    () => ({
      capture: () => state.current?.capture() ?? null,
      isReady: () => state.current?.isReady() ?? false,
      waitForSettled: (opts) => state.current?.waitForSettled(opts) ?? Promise.resolve(),
    }),
    [],
  );

  return (
    <div
      ref={containerRef}
      style={{
        width: params.size,
        height: params.size,
        position: 'relative',
        border: '1px solid #ccc',
        background: '#000',
      }}
    />
  );
});

interface SceneState {
  updateParams: (p: RenderParams) => void;
  capture: () => string | null;
  isReady: () => boolean;
  waitForSettled: (opts?: { settleMs?: number; timeoutMs?: number }) => Promise<void>;
  dispose: () => void;
}

function createScene(container: HTMLElement, apiKey: string, initial: RenderParams): SceneState {
  const scene = new ThreeScene();

  scene.add(new AmbientLight(0xffffff, 1.0));
  const sun = new DirectionalLight(0xffffff, 1.5);
  sun.position.set(1, 2, 1);
  scene.add(sun);

  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(initial.size, initial.size);
  container.appendChild(renderer.domElement);

  const initialOrtho = tileWidthMeters(initial.zoom, initial.center.lat);
  const half = initialOrtho / 2;
  const camera = new OrthographicCamera(-half, half, half, -half, 1, initialOrtho * 50);

  const tiles = new TilesRenderer();
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
  const reorient = new ReorientationPlugin({
    lat: initial.center.lat * (Math.PI / 180),
    lon: initial.center.lng * (Math.PI / 180),
    height: 0,
    recenter: true,
  });
  tiles.registerPlugin(reorient);
  tiles.registerPlugin(new TileCompressionPlugin());
  tiles.registerPlugin(new UpdateOnChangePlugin());

  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  scene.add(tiles.group);

  let disposed = false;
  let contentLoaded = false;
  tiles.addEventListener('load-tile-set', () => {
    contentLoaded = true;
  });

  positionCamera(camera, initial);

  const tick = () => {
    if (disposed) return;
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return {
    updateParams(p: RenderParams) {
      const ortho = tileWidthMeters(p.zoom, p.center.lat);
      const h = ortho / 2;
      camera.left = -h;
      camera.right = h;
      camera.top = h;
      camera.bottom = -h;
      camera.near = 1;
      camera.far = ortho * 50;
      camera.updateProjectionMatrix();

      if (p.size !== renderer.domElement.width / renderer.getPixelRatio()) {
        renderer.setSize(p.size, p.size);
        container.style.width = `${p.size}px`;
        container.style.height = `${p.size}px`;
      }

      reorient.transformLatLonHeightToOrigin(
        p.center.lat * (Math.PI / 180),
        p.center.lng * (Math.PI / 180),
        0,
      );

      positionCamera(camera, p);
    },
    capture() {
      renderer.render(scene, camera);
      // Export at logical (CSS) size, not the HiDPI backing-store size.
      // The backing canvas is devicePixelRatio× larger; stitchTiles uses
      // tilePixelSize as the step, so exporting at full DPR would make every
      // tile overlap in the composite on Retina displays.
      const canvas = renderer.domElement;
      const logicalSize = Math.round(canvas.width / renderer.getPixelRatio());
      const offscreen = document.createElement('canvas');
      offscreen.width = logicalSize;
      offscreen.height = logicalSize;
      offscreen.getContext('2d')?.drawImage(canvas, 0, 0, logicalSize, logicalSize);
      return offscreen.toDataURL('image/png');
    },
    isReady() {
      return contentLoaded;
    },
    waitForSettled(opts) {
      const settleMs = opts?.settleMs ?? 500;
      const timeoutMs = opts?.timeoutMs ?? 15000;
      return new Promise<void>((resolve, reject) => {
        const started = Date.now();
        let idleSince: number | null = null;
        const poll = () => {
          if (disposed) {
            reject(new Error('Scene.waitForSettled: disposed'));
            return;
          }
          const downloading = tiles.downloadQueue?.running ?? false;
          const parsing = tiles.parseQueue?.running ?? false;
          const now = Date.now();
          if (!downloading && !parsing) {
            if (idleSince === null) idleSince = now;
            if (now - idleSince >= settleMs) {
              resolve();
              return;
            }
          } else {
            idleSince = null;
          }
          if (now - started >= timeoutMs) {
            reject(new Error(`Scene.waitForSettled: timeout after ${timeoutMs}ms`));
            return;
          }
          setTimeout(poll, 100);
        };
        poll();
      });
    },
    dispose() {
      disposed = true;
      tiles.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}

function positionCamera(camera: OrthographicCamera, p: RenderParams): void {
  const yawRad = (p.yaw * Math.PI) / 180;
  const pitchRad = (p.pitch * Math.PI) / 180;
  const distance = tileWidthMeters(p.zoom, p.center.lat) * 10;

  const dx = Math.sin(yawRad) * Math.cos(pitchRad);
  const dy = Math.sin(pitchRad);
  const dz = Math.cos(yawRad) * Math.cos(pitchRad);

  camera.position.set(-dx * distance, dy * distance, -dz * distance);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}
