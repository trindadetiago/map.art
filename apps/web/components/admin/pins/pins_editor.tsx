'use client';

import type { VizPin } from '@mapart/export/types';
import {
  APIProvider,
  Map as GoogleMap,
  type MapMouseEvent,
  Marker,
} from '@vis.gl/react-google-maps';
import { useEffect, useState, useTransition } from 'react';

const INPUT =
  'h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-[13px] text-stone-900 outline-none transition focus:border-stone-400';
const SMALL_INPUT =
  'h-8 w-full rounded-md border border-stone-200 bg-white px-2 text-[12px] text-stone-900 tabular-nums outline-none transition focus:border-stone-400';
const BTN_PRIMARY =
  'h-9 rounded-full bg-stone-900 px-5 text-[13px] text-white transition hover:bg-stone-700 disabled:opacity-40';
const BTN_GHOST =
  'h-8 rounded-full border border-stone-200 px-3 text-[12px] text-stone-700 transition hover:border-stone-300 disabled:opacity-40';

type SaveAction = (
  projectId: string,
  pins: VizPin[],
) => Promise<{ ok: true; count: number } | { ok: false; error: string }>;

interface DraftPin {
  uid: string;
  lat: number;
  lng: number;
  label: string;
  kind: string;
}

let uidCounter = 0;
const newUid = () => `p${Date.now()}_${uidCounter++}`;
const formatCoord = (n: number) => String(Number(n.toFixed(6)));

const toDraft = (pin: VizPin): DraftPin => ({
  uid: newUid(),
  lat: pin.lat,
  lng: pin.lng,
  label: pin.label,
  kind: pin.kind ?? '',
});

export function PinsEditor({
  projectId,
  apiKey,
  center,
  initialPins,
  saveAction,
}: {
  projectId: string;
  apiKey: string;
  center: { lat: number; lng: number };
  initialPins: VizPin[];
  saveAction: SaveAction;
}) {
  const [pins, setPins] = useState<DraftPin[]>(() => initialPins.map(toDraft));
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null);

  function mutate(next: DraftPin[]) {
    setPins(next);
    setDirty(true);
    setStatus(null);
  }

  function addPin(lat: number, lng: number) {
    const uid = newUid();
    mutate([...pins, { uid, lat, lng, label: `Pin ${pins.length + 1}`, kind: '' }]);
    setSelected(uid);
  }

  const updatePin = (uid: string, patch: Partial<DraftPin>) =>
    mutate(pins.map((p) => (p.uid === uid ? { ...p, ...patch } : p)));

  function removePin(uid: string) {
    mutate(pins.filter((p) => p.uid !== uid));
    if (selected === uid) setSelected(null);
  }

  function save() {
    const payload: VizPin[] = pins.map((p) => {
      const label = p.label.trim();
      const kind = p.kind.trim();
      return kind ? { lat: p.lat, lng: p.lng, label, kind } : { lat: p.lat, lng: p.lng, label };
    });
    startTransition(async () => {
      const res = await saveAction(projectId, payload);
      if (res.ok) {
        setDirty(false);
        setStatus({ kind: 'ok', msg: `Saved ${res.count} pin${res.count === 1 ? '' : 's'}.` });
      } else {
        setStatus({ kind: 'error', msg: res.error });
      }
    });
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4">
      <div className="relative h-[560px] overflow-hidden rounded-2xl border border-stone-200/70 bg-stone-100">
        {apiKey ? (
          <APIProvider apiKey={apiKey}>
            <GoogleMap
              defaultCenter={center}
              defaultZoom={14}
              gestureHandling="greedy"
              disableDefaultUI
              className="h-full w-full"
              onClick={(e: MapMouseEvent) => {
                const ll = e.detail.latLng;
                if (ll) addPin(ll.lat, ll.lng);
              }}
            >
              {pins.map((p) => (
                <Marker
                  key={p.uid}
                  position={{ lat: p.lat, lng: p.lng }}
                  draggable
                  title={p.label}
                  onClick={() => setSelected(p.uid)}
                  onDragEnd={(e) => {
                    const ll = e.latLng;
                    if (ll) updatePin(p.uid, { lat: ll.lat(), lng: ll.lng() });
                  }}
                />
              ))}
            </GoogleMap>
          </APIProvider>
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <p className="m-0 max-w-[40ch] text-sm text-stone-500">
              Set <code className="rounded bg-stone-200 px-1">GOOGLE_MAPS_API_KEY</code> to place
              pins on a map. You can still add and edit pins by hand on the right.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col rounded-2xl border border-stone-200/70 bg-white">
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
          <span className="text-[13px] text-stone-700">
            {pins.length} pin{pins.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            className={BTN_GHOST}
            onClick={() => addPin(center.lat, center.lng)}
          >
            + add pin
          </button>
        </div>

        <div className="flex max-h-[420px] flex-col divide-y divide-stone-100 overflow-y-auto">
          {pins.length === 0 ? (
            <p className="m-0 px-4 py-10 text-center text-sm text-stone-400">
              No pins yet. {apiKey ? 'Click the map' : 'Use “add pin”'} to create one.
            </p>
          ) : (
            pins.map((p, i) => (
              <PinRow
                key={p.uid}
                index={i}
                pin={p}
                selected={selected === p.uid}
                onSelect={() => setSelected(p.uid)}
                onChange={(patch) => updatePin(p.uid, patch)}
                onRemove={() => removePin(p.uid)}
              />
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-stone-100 px-4 py-3">
          {status ? (
            <span
              className={`text-[12px] ${status.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}
            >
              {status.msg}
            </span>
          ) : (
            <span className="text-[12px] text-stone-400">
              {dirty ? 'unsaved changes' : 'all saved'}
            </span>
          )}
          <button type="button" className={BTN_PRIMARY} disabled={pending || !dirty} onClick={save}>
            {pending ? 'saving…' : 'save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PinRow({
  index,
  pin,
  selected,
  onSelect,
  onChange,
  onRemove,
}: {
  index: number;
  pin: DraftPin;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<DraftPin>) => void;
  onRemove: () => void;
}) {
  return (
    // Selection follows focus (bubbles up from the inputs), so it's keyboard- as
    // well as pointer-driven without making the row itself a tab stop.
    <div
      onFocus={onSelect}
      className={`flex flex-col gap-2 px-4 py-3 transition ${selected ? 'bg-stone-50' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-900 text-[10px] text-white">
          {index + 1}
        </span>
        <input
          value={pin.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="label"
          className={INPUT}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="shrink-0 text-[11px] text-stone-400 underline-offset-4 transition hover:text-red-600 hover:underline"
        >
          remove
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <CoordField label="lat" value={pin.lat} onChange={(v) => onChange({ lat: v })} />
        <CoordField label="lng" value={pin.lng} onChange={(v) => onChange({ lng: v })} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-stone-400">kind</span>
          <input
            value={pin.kind}
            onChange={(e) => onChange({ kind: e.target.value })}
            placeholder="optional"
            className={SMALL_INPUT}
          />
        </label>
      </div>
    </div>
  );
}

/** A coordinate input that keeps its own text while focused, so typing decimals
 * isn't clobbered, and re-syncs from the prop (e.g. after a marker drag) on blur. */
function CoordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(() => formatCoord(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatCoord(value));
  }, [value, focused]);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.12em] text-stone-400">{label}</span>
      <input
        inputMode="decimal"
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n);
        }}
        className={SMALL_INPUT}
      />
    </label>
  );
}
