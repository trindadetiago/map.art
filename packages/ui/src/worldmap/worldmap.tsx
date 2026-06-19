'use client';

import { useEffect, useRef } from 'react';
import { WORLDMAP_VARIANTS, type WorldMapVariant } from './variants';
import { paintWorldMap } from './worldmap_texture';

export interface WorldMapProps {
  variant?: WorldMapVariant;
  /** Override the variant's block size for the pixel-art render. */
  pixelSize?: number;
  oceanColor?: string;
  landColor?: string;
  borderColor?: string;
  borderWidth?: number;
  className?: string;
}

/**
 * A 2D Equal Earth world map painted on a canvas — the flat sibling of
 * `<Globe>`, with the same realistic/pixelated split. Fills its container and
 * repaints on resize; everything outside the map is transparent.
 */
export function WorldMap({
  variant = 'realistic',
  pixelSize,
  oceanColor,
  landColor,
  borderColor,
  borderWidth,
  className,
}: WorldMapProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const base = WORLDMAP_VARIANTS[variant];
    const config = {
      ...base,
      pixelSize: pixelSize ?? base.pixelSize,
      borderWidth: borderWidth ?? base.borderWidth,
      palette: {
        ocean: oceanColor ?? base.palette.ocean,
        land: landColor ?? base.palette.land,
        border: borderColor ?? base.palette.border,
      },
    };

    const paint = (): void => {
      const w = parent.clientWidth || 1;
      const h = parent.clientHeight || 1;
      paintWorldMap(canvas, w, h, config);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [variant, pixelSize, oceanColor, landColor, borderColor, borderWidth]);

  return <canvas ref={ref} className={className} />;
}
