'use client';

import { applyFrustum, createTilesRenderer, positionCamera, reorientTo } from '@mapart/renderer';
import type { RenderParams } from '@mapart/shared';
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

  const camera = new OrthographicCamera();
  applyFrustum(camera, initial.zoom, initial.center.lat);

  const { tiles, reorient } = createTilesRenderer({ apiKey, center: initial.center });
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
      applyFrustum(camera, p.zoom, p.center.lat);

      if (p.size !== renderer.domElement.width / renderer.getPixelRatio()) {
        renderer.setSize(p.size, p.size);
        container.style.width = `${p.size}px`;
        container.style.height = `${p.size}px`;
      }

      reorientTo(reorient, p.center);
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
