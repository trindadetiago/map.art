'use client';

import { Scene, type SceneHandle } from '@mapart/renderer/debug/Scene';
import type { RenderParams } from '@mapart/shared';
import { useEffect, useMemo, useRef } from 'react';

interface Props {
  apiKey: string;
  lat: number;
  lng: number;
  pitch: number;
  yaw: number;
  zoom: number;
  size: number;
}

declare global {
  interface Window {
    __scene?: SceneHandle | null;
    __sceneReady?: boolean;
  }
}

export function RenderWorkerClient({ apiKey, lat, lng, pitch, yaw, zoom, size }: Props) {
  const sceneRef = useRef<SceneHandle>(null);

  const params: RenderParams = useMemo(() => ({
    center: { lat, lng },
    pitch,
    yaw,
    size,
    zoom,
  }), [lat, lng, pitch, yaw, size, zoom]);

  useEffect(() => {
    window.__scene = sceneRef.current;
    window.__sceneReady = true;
    return () => {
      if (window.__scene === sceneRef.current) {
        window.__scene = undefined;
        window.__sceneReady = undefined;
      }
    };
  }, []);

  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        overflow: 'hidden',
        width: size,
        height: size,
        background: '#000',
      }}
    >
      <Scene ref={sceneRef} apiKey={apiKey} params={params} />
    </div>
  );
}
