'use client';

import type { VizGeoAnchor, VizPin } from '@mapart/export/types';
import type { LatLng } from '@mapart/geo';
import { useState } from 'react';
import { StepArea } from './step_area';
import { StepBuild, type TileLite } from './step_build';
import { StepCity } from './step_city';
import { StepPins } from './step_pins';
import { StepPublish } from './step_publish';
import { type StepId, StepRail } from './step_rail';
import { StepReview } from './step_review';

const DEFAULT_CENTER: LatLng = { lat: 40.7484, lng: -73.9857 }; // midtown Manhattan

export interface ProjectFlowProps {
  mode: 'create' | 'view';
  apiKey: string;
  /** view mode only */
  projectId?: string;
  projectName?: string;
  projectSlug?: string;
  initial?: { center: LatLng; cols: number; rows: number; cityLabel: string };
  initialTiles?: TileLite[];
  /** view mode only: grid↔WGS84 fit, for placing pins on the stitched art. */
  geo?: VizGeoAnchor;
  initialPins?: VizPin[];
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
  const canReview = isView;
  // Pins are placed on the stitched art via the grid↔WGS84 fit; without it
  // (e.g. a project with no tiles) there's nothing to anchor them to.
  const canPins = isView && !!props.geo;
  // Publishing rebuilds the pyramid from whatever tiles exist, so it needs a
  // saved project but nothing else.
  const canPublish = isView && !!props.projectId;

  const go = (s: StepId): void => {
    if (s === 2 && !canArea) return;
    if (s === 3 && !canBuild) return;
    if (s === 4 && !canReview) return;
    if (s === 5 && !canPins) return;
    if (s === 6 && !canPublish) return;
    setActive(s);
  };

  return (
    <div className="flex h-[calc(100vh-120px)] gap-5">
      <StepRail
        active={active}
        onSelect={go}
        canArea={canArea}
        canBuild={canBuild}
        canReview={canReview}
        canPins={canPins}
        canPublish={canPublish}
      />

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
            {...(props.projectId ? { projectId: props.projectId } : {})}
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

        {active === 4 && props.projectId && (
          <StepReview
            projectId={props.projectId}
            projectName={props.projectName ?? ''}
            cols={cols}
            rows={rows}
            initialTiles={props.initialTiles ?? []}
          />
        )}

        {active === 6 && props.projectId && (
          <StepPublish
            projectId={props.projectId}
            {...(props.projectSlug ? { projectSlug: props.projectSlug } : {})}
          />
        )}

        {active === 5 && props.projectId && props.geo && (
          <StepPins
            projectId={props.projectId}
            projectName={props.projectName ?? ''}
            cols={cols}
            rows={rows}
            geo={props.geo}
            initialTiles={props.initialTiles ?? []}
            initialPins={props.initialPins ?? []}
          />
        )}
      </div>
    </div>
  );
}
