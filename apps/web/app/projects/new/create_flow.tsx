'use client';

import { gridCells, tileCenterLatLng, tileFootprint } from '@mapart/renderer/params';
import {
  APIProvider,
  Map as GoogleMap,
  type MapCameraChangedEvent,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createProjectWithGrid } from '../actions';

const DEFAULT_CENTER = { lat: 40.7484, lng: -73.9857 }; // midtown Manhattan
const DEFAULT_ZOOM = 16;

interface LatLng {
  lat: number;
  lng: number;
}

/** Origin (tile 0,0) that places a cols×rows grid centered on `center`. */
function originForCenter(center: LatLng, cols: number, rows: number): LatLng {
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const probe = tileCenterLatLng(center, cx, cy);
  // tileCenterLatLng is origin + offset, so origin = 2·center − probe.
  return { lat: 2 * center.lat - probe.lat, lng: 2 * center.lng - probe.lng };
}

export function CreateProjectFlow({ apiKey }: { apiKey: string }) {
  const [center, setCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [cols, setCols] = useState(5);
  const [rows, setRows] = useState(5);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const origin = useMemo(() => originForCenter(center, cols, rows), [center, cols, rows]);

  async function confirm() {
    if (!name.trim()) {
      setError('name is required');
      return;
    }
    setPending(true);
    setError(null);
    const res = await createProjectWithGrid({ name, lat: origin.lat, lng: origin.lng, cols, rows });
    if (res.ok) {
      router.push('/projects');
    } else {
      setPending(false);
      setError(res.error);
    }
  }

  return (
    <APIProvider apiKey={apiKey}>
      <div className="relative h-[calc(100vh-120px)] w-full overflow-hidden rounded-2xl border border-stone-200">
        <GoogleMap
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          gestureHandling="greedy"
          disableDefaultUI
          className="h-full w-full"
          onCameraChanged={(e: MapCameraChangedEvent) => setCenter(e.detail.center)}
        >
          <GridOverlay origin={origin} cols={cols} rows={rows} />
        </GoogleMap>

        {/* crosshair marking the grid center */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-4 rounded-full border-2 border-sky-600 bg-white/40" />
        </div>

        <div className="absolute left-4 top-4 w-80">
          <SearchBox />
        </div>

        <div className="absolute bottom-4 left-4 w-80 rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-lg backdrop-blur">
          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
              name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my project"
              className="mt-1 h-9 w-full rounded-lg border border-stone-200 px-3 text-[13px] outline-none focus:border-stone-400"
            />
          </label>

          <div className="mt-3 flex gap-3">
            <Stepper label="cols" value={cols} onChange={setCols} />
            <Stepper label="rows" value={rows} onChange={setRows} />
          </div>

          <div className="mt-3 flex items-center justify-between text-[12px] text-stone-500">
            <span>
              {cols}×{rows} = <strong className="text-stone-800">{cols * rows}</strong> tiles
            </span>
            <span className="tabular-nums">
              {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
            </span>
          </div>

          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="mt-3 h-9 w-full rounded-full bg-stone-900 text-[13px] text-white transition hover:bg-stone-700 disabled:opacity-50"
          >
            {pending ? 'creating…' : 'create project'}
          </button>
          {error && <p className="mt-2 mb-0 text-xs text-red-600">{error}</p>}
        </div>
      </div>
    </APIProvider>
  );
}

/** Draws every tile's true footprint as a translucent polygon on the map. */
function GridOverlay({ origin, cols, rows }: { origin: LatLng; cols: number; rows: number }) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const polysRef = useRef<google.maps.Polygon[]>([]);

  useEffect(() => {
    if (!map || !mapsLib) return;
    const polys = gridCells(origin, cols, rows).map((cell) => {
      const corners = tileFootprint(origin, cell.x, cell.y);
      return new mapsLib.Polygon({
        paths: corners.map((c) => ({ lat: c.lat, lng: c.lng })),
        strokeColor: '#0c4a6e',
        strokeOpacity: 0.6,
        strokeWeight: 1,
        fillColor: '#0ea5e9',
        fillOpacity: 0.12,
        clickable: false,
        map,
      });
    });
    polysRef.current = polys;
    return () => {
      for (const p of polys) p.setMap(null);
      polysRef.current = [];
    };
  }, [map, mapsLib, origin, cols, rows]);

  return null;
}

/** City search → recenters the map. */
function SearchBox() {
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
      const loc = results[0]?.geometry.location;
      if (loc) {
        map.panTo(loc);
        map.setZoom(16);
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
      className="flex gap-2 rounded-2xl border border-stone-200 bg-white/95 p-2 shadow-lg backdrop-blur"
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

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.max(1, Math.min(30, n));
  return (
    <label className="block flex-1">
      <span className="block text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
        {label}
      </span>
      <div className="mt-1 flex h-9 items-center rounded-lg border border-stone-200">
        <button
          type="button"
          onClick={() => onChange(clamp(value - 1))}
          className="h-full w-8 text-stone-500 hover:text-stone-900"
        >
          −
        </button>
        <input
          value={value}
          onChange={(e) => onChange(clamp(Number.parseInt(e.target.value, 10) || 1))}
          className="h-full w-full min-w-0 border-x border-stone-200 text-center text-[13px] outline-none tabular-nums"
        />
        <button
          type="button"
          onClick={() => onChange(clamp(value + 1))}
          className="h-full w-8 text-stone-500 hover:text-stone-900"
        >
          +
        </button>
      </div>
    </label>
  );
}
