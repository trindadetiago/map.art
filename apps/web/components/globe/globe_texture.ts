import { type GeoPermissibleObjects, geoEquirectangular, geoPath } from 'd3-geo';
import { getCountryFeatures } from './countries';
import type { GlobeVariantConfig } from './variants';

/**
 * Paint countries onto an equirectangular canvas that wraps cleanly onto a
 * three.js sphere. d3-geo handles antimeridian cutting so polygons that cross
 * the dateline (Russia, Fiji) don't smear across the map.
 */
export function buildGlobeTexture(config: GlobeVariantConfig): HTMLCanvasElement {
  const { width, height, borderWidth } = config.texture;
  const { ocean, land, border } = config.palette;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('globe texture: 2d canvas context unavailable');

  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, width, height);

  const projection = geoEquirectangular().fitSize([width, height], { type: 'Sphere' });
  const path = geoPath(projection, ctx);

  ctx.fillStyle = land;
  ctx.strokeStyle = border;
  ctx.lineWidth = borderWidth;
  ctx.lineJoin = 'round';

  for (const f of getCountryFeatures()) {
    ctx.beginPath();
    path(f as GeoPermissibleObjects);
    ctx.fill();
    if (borderWidth > 0) ctx.stroke();
  }

  return canvas;
}
