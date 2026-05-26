import { env } from '@mapart/env';
import { RenderWorkerClient } from './render-worker-client';

interface Props {
  searchParams: Promise<{
    lat?: string;
    lng?: string;
    pitch?: string;
    yaw?: string;
    zoom?: string;
    size?: string;
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

  const params = {
    lat: latRaw && latRaw.length > 0 ? parseFloat(latRaw) : -7.12,
    lng: lngRaw && lngRaw.length > 0 ? parseFloat(lngRaw) : -34.86,
    pitch: pitchRaw && pitchRaw.length > 0 ? parseFloat(pitchRaw) : 60,
    yaw: yawRaw && yawRaw.length > 0 ? parseFloat(yawRaw) : 0,
    zoom: zoomRaw && zoomRaw.length > 0 ? parseFloat(zoomRaw) : 18,
    size: sizeRaw && sizeRaw.length > 0 ? parseInt(sizeRaw, 10) : 1024,
  };

  return <RenderWorkerClient apiKey={env.googleMapsApiKey ?? ''} {...params} />;
}
