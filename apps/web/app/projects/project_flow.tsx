'use client';

import type { LatLng } from '@mapart/geo';
import { useState } from 'react';
import { StepArea } from './step_area';
import { StepBuild, type TileLite } from './step_build';
import { StepCity } from './step_city';
import { type StepId, StepRail } from './step_rail';

const DEFAULT_CENTER: LatLng = { lat: 40.7484, lng: -73.9857 }; // midtown Manhattan

export interface ProjectFlowProps {
  mode: 'create' | 'view';
  apiKey: string;
  /** view mode only */
  projectId?: string;
  projectName?: string;
  initial?: { center: LatLng; cols: number; rows: number; cityLabel: string };
  initialTiles?: TileLite[];
}

/**
 * Two-column project shell: a left step-rail (City → Area → Build) and a right
 * pane showing the active step. Drives both creating a project (steps 1–2, then
 * confirm) and viewing one (opens on the live Build step; steps 1–2 are
 * read-only reconstructions derived from the tile grid).
 */
export function ProjectFlow(props: ProjectFlowProps) {
  const isView = props.mode === 'view';
  const [center, setCenter] = useState<LatLng>(props.initial?.center ?? DEFAULT_CENTER);
  const [cityLabel, setCityLabel] = useState(props.initial?.cityLabel ?? '');
  const [cols, setCols] = useState(props.initial?.cols ?? 5);
  const [rows, setRows] = useState(props.initial?.rows ?? 5);
  const [hasCity, setHasCity] = useState(isView);
  const [active, setActive] = useState<StepId>(isView ? 3 : 1);

  const canArea = isView || hasCity;
  const canBuild = isView;

  const go = (s: StepId): void => {
    if (s === 2 && !canArea) return;
    if (s === 3 && !canBuild) return;
    setActive(s);
  };

  return (
    <div className="flex h-[calc(100vh-120px)] gap-5">
      <StepRail active={active} onSelect={go} canArea={canArea} canBuild={canBuild} />

      <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-stone-200 bg-white">
        {active === 1 && (
          <StepCity
            apiKey={props.apiKey}
            center={center}
            cityLabel={cityLabel}
            readOnly={isView}
            onPick={(c, label) => {
              setCenter(c);
              setCityLabel(label);
              setHasCity(true);
            }}
            onNext={() => go(2)}
          />
        )}

        {active === 2 && (
          <StepArea
            apiKey={props.apiKey}
            center={center}
            cols={cols}
            rows={rows}
            readOnly={isView}
            cityLabel={cityLabel}
            onCenterChange={setCenter}
            onCols={setCols}
            onRows={setRows}
          />
        )}

        {active === 3 && props.projectId && (
          <StepBuild
            apiKey={props.apiKey}
            center={center}
            projectId={props.projectId}
            projectName={props.projectName ?? ''}
            cols={cols}
            rows={rows}
            initialTiles={props.initialTiles ?? []}
          />
        )}
      </div>
    </div>
  );
}
