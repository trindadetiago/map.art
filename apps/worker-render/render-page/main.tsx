import { Scene, type SceneHandle } from '@mapart/scene';
import type { RenderParams } from '@mapart/shared';
import { StrictMode, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';

declare global {
  interface Window {
    __scene?: SceneHandle | null;
    __sceneReady?: boolean;
  }
}

function safeFloat(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function safeInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * This page is only ever loaded by Puppeteer (from worker.ts). It reads every
 * parameter it needs — including the Google Maps API key — from the URL the
 * worker constructs. There is no env-var fallback on purpose: opening this URL
 * manually is not a supported path.
 */
function App() {
  const sceneRef = useRef<SceneHandle>(null);

  const { apiKey, params } = useMemo(() => {
    const sp = new URLSearchParams(window.location.search);
    return {
      apiKey: sp.get('apiKey') ?? '',
      params: {
        center: { lat: safeFloat(sp.get('lat'), 0), lng: safeFloat(sp.get('lng'), 0) },
        pitch: safeFloat(sp.get('pitch'), 60),
        yaw: safeFloat(sp.get('yaw'), 0),
        zoom: safeFloat(sp.get('zoom'), 18),
        size: safeInt(sp.get('size'), 1024),
      } satisfies RenderParams,
    };
  }, []);

  useEffect(() => {
    window.__scene = sceneRef.current;
    window.__sceneReady = true;
    return () => {
      window.__scene = null;
      window.__sceneReady = false;
    };
  }, []);

  return <Scene ref={sceneRef} apiKey={apiKey} params={params} />;
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('no #root');
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
