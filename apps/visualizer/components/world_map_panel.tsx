'use client';

import { WORLDMAP_VARIANTS, paintWorldMap } from '@mapart/ui/worldmap';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export interface WorldProject {
  id: string;
  name: string;
  year: number | null;
  lat: number;
  lng: number;
}

interface Placed {
  project: WorldProject;
  x: number;
  y: number;
}

/** Pixel-art Equal Earth map matches the brand; flip to 'realistic' for a smooth map. */
const VARIANT = 'pixelated' as const;

/**
 * A flat Equal Earth world map that fills its parent, with one pin per project.
 * Hover reveals the name; click opens its framed deep-zoom view. Pins are DOM
 * overlays positioned through the map's own projection, so they track resizes.
 */
export function WorldMapPanel({ projects }: { projects: WorldProject[] }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);

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
        {placed.map(({ project, x, y }) => (
          <button
            type="button"
            key={project.id}
            className="group -translate-x-1/2 -translate-y-full absolute z-10 flex cursor-pointer flex-col items-center border-none bg-transparent p-0"
            style={{ left: x, top: y }}
            onClick={() => router.push(`/?project=${project.id}`)}
          >
            <span className="mb-[5px] inline-flex translate-y-[3px] items-baseline gap-1.5 whitespace-nowrap rounded-full border border-[rgba(234,230,220,0.18)] bg-[rgba(12,11,10,0.9)] px-[9px] py-[3px] font-semibold text-[#eae6dc] text-[12px] opacity-0 shadow-[0_4px_14px_rgba(0,0,0,0.5)] transition group-hover:translate-y-0 group-hover:opacity-100">
              {project.name}
              {project.year !== null && (
                <span className="font-medium text-[#d8be7e] tabular-nums">{project.year}</span>
              )}
            </span>
            <span className="block h-[11px] w-[11px] rounded-full border-2 border-[#14110c] bg-[#ffcf4d] shadow-[0_1px_4px_rgba(0,0,0,0.7)] transition-transform group-hover:scale-[1.4]" />
          </button>
        ))}
      </div>
    </div>
  );
}
