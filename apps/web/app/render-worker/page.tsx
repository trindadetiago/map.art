import { env } from '@mapart/env';
import { RenderWorkerClient } from './render_worker_client';

// TODO: move this to @mapart/env schema once RENDER_WORKER_TOKEN is registered there
const RENDER_WORKER_TOKEN = process.env.RENDER_WORKER_TOKEN ?? 'dev-token-placeholder';

interface Props {
  searchParams: Promise<{
    lat?: string;
    lng?: string;
    pitch?: string;
    yaw?: string;
    zoom?: string;
    size?: string;
    token?: string;
  }>;
}

export default async function RenderWorkerPage({ searchParams }: Props) {
  const sp = await searchParams;
  const latRaw = sp.lat;
  const lngRaw = sp.lng;
  const pitchRaw = sp.pitch;
  const yawRaw = sp.yaw;
  const zoomRaw = sp.zoom;
  const sizeRaw = sp.size;
  const tokenRaw = sp.token;

  if (tokenRaw !== RENDER_WORKER_TOKEN) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'monospace', background: '#111', color: '#f66' }}>
        <h1>403 — Unauthorized</h1>
        <p>Invalid or missing render token.</p>
      </div>
    );
  }

  const safeFloat = (raw: string | undefined, fallback: number): number =>
    raw !== undefined && !Number.isNaN(Number(raw)) ? Number(raw) : fallback;

  const safeInt = (raw: string | undefined, fallback: number): number =>
    raw !== undefined && !Number.isNaN(Number(raw)) ? Number.parseInt(raw, 10) : fallback;

  const params = {
    lat: safeFloat(latRaw, -7.12),
    lng: safeFloat(lngRaw, -34.86),
    pitch: safeFloat(pitchRaw, 60),
    yaw: safeFloat(yawRaw, 0),
    zoom: safeFloat(zoomRaw, 18),
    size: safeInt(sizeRaw, 1024),
  };

  return <RenderWorkerClient apiKey={env.googleMapsApiKey ?? ''} {...params} />;
}
