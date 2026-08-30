'use client';

import type { VizProject } from '@/lib/project';
import { WORLDMAP_VARIANTS, paintWorldMap } from '@mapart/ui/worldmap';
import { useEffect, useRef, useState } from 'react';
import { MiniMap } from './mini_map';

interface Placed {
  project: VizProject;
  x: number;
  y: number;
}

interface Site {
  name: string;
  lat: number;
  lng: number;
}

interface PlacedSite {
  site: Site;
  x: number;
  y: number;
}

/**
 * Cities being built right now. They have no project, no pyramid and nothing to
 * open — they're on the map to show where the next one is coming from, so they
 * are pinned in bone rather than gold and don't respond to a click.
 */
const BUILDING: Site[] = [{ name: 'San Francisco', lat: 37.7749, lng: -122.4194 }];

/** Pixel-art Equal Earth map matches the brand; flip to 'realistic' for a smooth map. */
const VARIANT = 'pixelated' as const;

/** Gold reads as finished and openable; bone as still under the brush. */
const PIN_DONE = '#ffcf4d';
const PIN_BUILDING = '#f3ecd9';

/** Peek card width, and the fraction of the map above which it flips downward. */
const PEEK_WIDTH = 190;
const FLIP_BELOW = 0.45;

/**
 * A flat Equal Earth world map that fills its parent, with one pin per project
 * plus one per city still being built. Hovering a project pin peeks at its map
 * and clicking hands the slug to `onOpenProject`; a building pin only names
 * itself. Pins are DOM overlays positioned through the map's own projection, so
 * they track resizes.
 */
export function WorldMapPanel({
  projects,
  onOpenProject,
}: {
  projects: VizProject[];
  onOpenProject: (slug: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [building, setBuilding] = useState<PlacedSite[]>([]);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const config = WORLDMAP_VARIANTS[VARIANT];
    const paint = (): void => {
      const w = root.clientWidth || 1;
      const h = root.clientHeight || 1;
      const projection = paintWorldMap(canvas, w, h, config);
      const next: Placed[] = [];
      for (const p of projects) {
        const xy = projection([p.lng, p.lat]);
        if (xy) next.push({ project: p, x: xy[0], y: xy[1] });
      }
      setPlaced(next);

      const sites: PlacedSite[] = [];
      for (const site of BUILDING) {
        const xy = projection([site.lng, site.lat]);
        if (xy) sites.push({ site, x: xy[0], y: xy[1] });
      }
      setBuilding(sites);
      setHeight(h);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(root);
    return () => ro.disconnect();
  }, [projects]);

  return (
    <div ref={rootRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="absolute inset-0">
        {placed.map(({ project, x, y }) => {
          // Near the top of the map there's no room above the pin for the peek,
          // and the hero clips it — drop it below the pin instead.
          const below = height > 0 && y / height < FLIP_BELOW;
          return (
            <button
              type="button"
              key={project.id}
              aria-label={`Open the ${project.name} map`}
              className="group -translate-x-1/2 -translate-y-full absolute z-10 cursor-pointer border-none bg-transparent p-0"
              style={{ left: x, top: y }}
              onClick={(e) => {
                e.stopPropagation();
                onOpenProject(project.slug);
              }}
            >
              <div
                className={`-translate-x-1/2 pointer-events-none absolute left-1/2 z-20 scale-95 opacity-0 transition duration-200 ease-out group-hover:scale-100 group-hover:opacity-100 ${
                  below ? 'top-[calc(100%+8px)]' : 'bottom-[calc(100%+8px)]'
                }`}
                style={{ width: PEEK_WIDTH }}
              >
                <MiniMap project={project} size="peek" />
              </div>

              <span className="map-pin relative block">
                {/* A 20px marker is a small thing to land on. This invisible box
                    around it widens the target without moving the pin: hovering
                    a child counts as hovering its ancestors, overflow included. */}
                <span
                  className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 h-14 w-14"
                  aria-hidden="true"
                />
                <span className="map-pin-pulse" aria-hidden="true" />
                <PinGlyph fill={PIN_DONE} />
              </span>
            </button>
          );
        })}

        {building.map(({ site, x, y }) => {
          const below = height > 0 && y / height < FLIP_BELOW;
          return (
            <div
              key={site.name}
              title={`${site.name} — building`}
              className="group -translate-x-1/2 -translate-y-full absolute z-10"
              style={{ left: x, top: y }}
            >
              <div
                className={`-translate-x-1/2 pointer-events-none absolute left-1/2 z-20 translate-y-1 whitespace-nowrap px-2.5 py-1 text-center opacity-0 transition duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100 ${
                  below ? 'top-[calc(100%+8px)]' : 'bottom-[calc(100%+8px)]'
                }`}
                style={{
                  background: PIN_BUILDING,
                  boxShadow: [
                    '0 0 0 2px #241a09',
                    'inset 2px 2px 0 0 #fffaf0',
                    'inset -2px -2px 0 0 #d8cdaa',
                  ].join(', '),
                }}
              >
                <div className="font-pixel text-[12px] text-[#14110c]">{site.name}</div>
                <div className="text-[10px] text-[#7a6f57]">building…</div>
              </div>

              <span className="map-pin relative block">
                <span className="map-pin-pulse map-pin-pulse--building" aria-hidden="true" />
                <PinGlyph fill={PIN_BUILDING} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A blocky map marker drawn on an 11x14 pixel grid — every edge lands on a whole
 * unit and rendering stays crisp, so it belongs to the same pixel-art world as
 * the map under it. `xMidYMax` pins the tip to the bottom edge, which is the
 * anchor point the projection places.
 */
function PinGlyph({ fill }: { fill: string }) {
  return (
    <svg
      viewBox="0 -0.5 11 15.5"
      width="20"
      height="28"
      shapeRendering="crispEdges"
      preserveAspectRatio="xMidYMax meet"
      className="relative block drop-shadow-[0_2px_0_rgba(0,0,0,0.25)] transition-transform duration-200 ease-out group-hover:-translate-y-1"
      aria-hidden="true"
    >
      <path
        d="M3 0 H8 V1 H10 V7 H9 V9 H8 V11 H7 V13 H6 V14 H5 V13 H4 V11 H3 V9 H2 V7 H1 V1 H3 Z"
        fill={fill}
        stroke="#14110c"
        strokeWidth="1"
        strokeLinejoin="miter"
      />
      <rect x="4" y="2" width="3" height="3" fill="#14110c" />
    </svg>
  );
}
