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
 * The visualizer home: a flat Equal Earth world map with one pin per exported
 * project. Hover reveals the name; click flies into its framed deep-zoom view.
 * Pins are DOM overlays positioned through the map's own projection, so they
 * track the map across resizes.
 */
export function WorldMapHome({ projects }: { projects: WorldProject[] }) {
  const router = useRouter();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    const config = WORLDMAP_VARIANTS[VARIANT];
    const paint = (): void => {
      const w = stage.clientWidth || 1;
      const h = stage.clientHeight || 1;
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
    ro.observe(stage);
    return () => ro.disconnect();
  }, [projects]);

  return (
    <div ref={stageRef} className="worldmap-stage">
      <canvas ref={canvasRef} className="worldmap-canvas" />

      <div className="worldmap-pins">
        {placed.map(({ project, x, y }) => (
          <button
            type="button"
            key={project.id}
            className={`worldmap-pin${hovered === project.id ? ' is-hovered' : ''}`}
            style={{ left: x, top: y }}
            onMouseEnter={() => setHovered(project.id)}
            onMouseLeave={() => setHovered((h) => (h === project.id ? null : h))}
            onClick={() => router.push(`/?project=${project.id}`)}
          >
            <span className="worldmap-pin-label">
              {project.name}
              {project.year !== null && <span className="worldmap-pin-year">{project.year}</span>}
            </span>
            <span className="worldmap-pin-dot" />
          </button>
        ))}
      </div>

      <div className="worldmap-title">
        <h1>map.art</h1>
        <p>
          {projects.length === 0
            ? 'No exported maps yet.'
            : `${projects.length} ${projects.length === 1 ? 'map' : 'maps'} · click a pin to explore`}
        </p>
      </div>
    </div>
  );
}
