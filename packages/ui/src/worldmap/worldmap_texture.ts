import { type GeoPermissibleObjects, type GeoProjection, geoEqualEarth, geoPath } from 'd3-geo';
import { getCountryFeatures } from '../globe/countries';
import type { WorldMapVariantConfig } from './variants';

/** Equal Earth projection fitted to a `width × height` box, sphere centred. */
export function equalEarthProjection(width: number, height: number): GeoProjection {
  return geoEqualEarth().fitSize([width, height], { type: 'Sphere' });
}

/**
 * Paint the Equal Earth world (ocean disc + country fills) onto a 2D context.
 * Everything outside the sphere is left transparent so the map floats on the
 * page background.
 */
export function drawWorldMap(
  ctx: CanvasRenderingContext2D,
  projection: GeoProjection,
  config: WorldMapVariantConfig,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  const path = geoPath(projection, ctx);

  ctx.beginPath();
  path({ type: 'Sphere' });
  ctx.fillStyle = config.palette.ocean;
  ctx.fill();

  ctx.fillStyle = config.palette.land;
  ctx.strokeStyle = config.palette.border;
  ctx.lineWidth = config.borderWidth;
  ctx.lineJoin = 'round';
  for (const f of getCountryFeatures()) {
    ctx.beginPath();
    path(f as GeoPermissibleObjects);
    ctx.fill();
    if (config.borderWidth > 0) ctx.stroke();
  }
}

/**
 * Render the map to a canvas sized for its container and return the projection
 * in display coordinates (use it to place lat/lng overlays). For the pixelated
 * variant the canvas is rendered at `1/pixelSize` resolution and scaled up with
 * nearest-neighbour, so the returned projection is fitted to the full display
 * size to stay aligned with the upscaled pixels.
 */
export function paintWorldMap(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  config: WorldMapVariantConfig,
): GeoProjection {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('worldmap: 2d canvas context unavailable');

  if (config.pixelSize) {
    const ps = config.pixelSize;
    const iw = Math.max(1, Math.round(width / ps));
    const ih = Math.max(1, Math.round(height / ps));
    canvas.width = iw;
    canvas.height = ih;
    drawWorldMap(ctx, equalEarthProjection(iw, ih), config, iw, ih);
    // Canvas fills are anti-aliased, so every land/ocean edge has blended
    // pixels; nearest-neighbour upscaling would smear them into soft blocks.
    // Snap each pixel to the nearest palette colour for hard pixel-art edges.
    snapToPalette(ctx, iw, ih, config);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.imageRendering = 'pixelated';
  } else {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.imageRendering = '';
    drawWorldMap(ctx, equalEarthProjection(width, height), config, width, height);
  }

  return equalEarthProjection(width, height);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Hard-quantise a rendered canvas to the variant's palette: clear near-empty
 * pixels (the anti-aliased sphere edge) and snap the rest to the nearest palette
 * colour, so no blended edge pixels survive into the upscaled pixel-art.
 */
function snapToPalette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  config: WorldMapVariantConfig,
): void {
  const palette: [number, number, number][] = [
    hexToRgb(config.palette.ocean),
    hexToRgb(config.palette.land),
  ];
  if (config.borderWidth > 0) palette.push(hexToRgb(config.palette.border));

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if ((d[i + 3] ?? 0) < 128) {
      d[i + 3] = 0;
      continue;
    }
    const r = d[i] ?? 0;
    const g = d[i + 1] ?? 0;
    const b = d[i + 2] ?? 0;
    let best = palette[0] ?? [0, 0, 0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const c of palette) {
      const dist = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    d[i] = best[0];
    d[i + 1] = best[1];
    d[i + 2] = best[2];
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
