'use client';

import type { LatLng } from '@mapart/geo';
import {
  APIProvider,
  Map as GoogleMap,
  type MapCameraChangedEvent,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { type FormEvent, useMemo, useRef, useState } from 'react';

const DEFAULT_ZOOM = 12;

const fmtCoords = (c: LatLng): string => `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;

export function StepCity({
  apiKey,
  center,
  cityLabel,
  readOnly,
  onPick,
  onNext,
}: {
  apiKey: string;
  center: LatLng;
  cityLabel: string;
  readOnly: boolean;
  onPick: (center: LatLng, label: string) => void;
  onNext: () => void;
}) {
  // The map pans freely under a fixed crosshair; the crosshair marks the chosen
  // point, so the live center is just the map center.
  const liveCenter = useRef<LatLng>(center);
  const [label, setLabel] = useState(cityLabel);

  return (
    <APIProvider apiKey={apiKey}>
      <GoogleMap
        defaultCenter={center}
        defaultZoom={DEFAULT_ZOOM}
        gestureHandling="greedy"
        disableDefaultUI
        className="h-full w-full"
        onCameraChanged={(e: MapCameraChangedEvent) => {
          liveCenter.current = e.detail.center;
        }}
      />

      {/* crosshair pin marking the chosen location */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="-translate-y-2 h-5 w-5 rounded-full border-2 border-sky-600 bg-white/50 shadow" />
      </div>

      {!readOnly && (
        <div className="absolute left-4 top-4 w-80">
          <SearchBox
            onResult={(loc, address) => {
              liveCenter.current = loc;
              setLabel(address);
            }}
          />
        </div>
      )}

      <div className="absolute right-4 bottom-4 flex items-center gap-3 rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-lg backdrop-blur">
        <span className="px-1 text-[12px] text-stone-500">
          {label || fmtCoords(readOnly ? center : liveCenter.current)}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={() => {
              onPick(liveCenter.current, label);
              onNext();
            }}
            className="h-9 rounded-full bg-stone-900 px-5 text-[13px] text-white transition hover:bg-stone-700"
          >
            frame the area →
          </button>
        )}
      </div>
    </APIProvider>
  );
}

/** City / address search → recenters the map and reports the picked location. */
function SearchBox({ onResult }: { onResult: (loc: LatLng, address: string) => void }) {
  const map = useMap();
  const geocodingLib = useMapsLibrary('geocoding');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const geocoder = useMemo(
    () => (geocodingLib ? new geocodingLib.Geocoder() : null),
    [geocodingLib],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!geocoder || !map || !q.trim()) return;
    setSearching(true);
    setNotFound(false);
    try {
      const { results } = await geocoder.geocode({ address: q });
      const first = results[0];
      const loc = first?.geometry.location;
      if (loc) {
        const ll = { lat: loc.lat(), lng: loc.lng() };
        map.panTo(loc);
        map.setZoom(13);
        onResult(ll, first?.formatted_address ?? '');
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setSearching(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="relative flex gap-2 rounded-2xl border border-stone-200 bg-white/95 p-2 shadow-lg backdrop-blur"
    >
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setNotFound(false);
        }}
        placeholder="search a city or address…"
        className="h-8 flex-1 rounded-lg px-2 text-[13px] outline-none"
      />
      <button
        type="submit"
        disabled={searching}
        className="h-8 rounded-lg bg-stone-900 px-3 text-[12px] text-white disabled:opacity-50"
      >
        {searching ? '…' : 'go'}
      </button>
      {notFound && <span className="absolute -bottom-5 left-2 text-xs text-red-600">no match</span>}
    </form>
  );
}
