'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';

export interface MinimapProps {
  centerLat: number;
  centerLng: number;
  initialZoom: number;
  minZoom: number;
  maxZoom: number;
  width?: number;
  height?: number;
  onCenterChange: (lat: number, lng: number) => void;
}

export function Minimap({
  centerLat,
  centerLng,
  initialZoom,
  minZoom,
  maxZoom,
  width = 260,
  height = 200,
  onCenterChange,
}: MinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const callbackRef = useRef(onCenterChange);
  const initialViewRef = useRef({
    centerLat,
    centerLng,
    initialZoom,
    minZoom,
    maxZoom,
  });

  useEffect(() => {
    callbackRef.current = onCenterChange;
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const initialView = initialViewRef.current;
    const map = L.map(containerRef.current, {
      center: [initialView.centerLat, initialView.centerLng],
      zoom: initialView.initialZoom,
      minZoom: initialView.minZoom,
      maxZoom: initialView.maxZoom,
      zoomControl: true,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: true,
      doubleClickZoom: false,
      touchZoom: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: initialView.maxZoom,
    }).addTo(map);
    map.on('move', () => {
      const c = map.getCenter();
      callbackRef.current(c.lat, c.lng);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const same = Math.abs(c.lat - centerLat) < 1e-6 && Math.abs(c.lng - centerLng) < 1e-6;
    if (!same) map.setView([centerLat, centerLng], map.getZoom(), { animate: false });
  }, [centerLat, centerLng]);

  return (
    <div
      className="absolute bottom-3 left-3 z-10 overflow-hidden rounded-md border-2 border-white bg-neutral-200 shadow-[0_6px_18px_rgba(0,0,0,0.45)]"
      style={{ width, height }}
    >
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-[1000] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-600 bg-red-600/25" />
      <div className="pointer-events-none absolute left-1.5 top-1.5 rounded-sm bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white">
        drag to re-center
      </div>
    </div>
  );
}
