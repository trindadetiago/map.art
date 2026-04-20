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
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        width,
        height,
        border: '2px solid #fff',
        borderRadius: 6,
        overflow: 'hidden',
        boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
        zIndex: 10,
        background: '#eee',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          zIndex: 1000,
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: '2px solid #dc2626',
          background: 'rgba(220, 38, 38, 0.25)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          fontSize: 10,
          padding: '2px 6px',
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          borderRadius: 3,
          fontFamily: 'monospace',
          pointerEvents: 'none',
        }}
      >
        drag to re-center
      </div>
    </div>
  );
}
