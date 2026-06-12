import { tileWidthMeters } from '@mapart/geo';
import {
  bboxToTiles,
  circleToPolygon,
  latLngToTile,
  polygonToTiles,
  tileToBounds,
  tileToBoundsWkt,
  tileToCenter,
} from '@mapart/geo';
import type { Command } from 'commander';

export function registerTilesCommands(parent: Command): void {
  parent
    .command('for-point')
    .description('Tile coord containing a given lat/lng at zoom')
    .requiredOption('--lat <n>', 'latitude', Number.parseFloat)
    .requiredOption('--lng <n>', 'longitude', Number.parseFloat)
    .requiredOption('--zoom <z>', 'zoom', (v) => Number.parseInt(v, 10))
    .action((opts) => {
      const t = latLngToTile(opts.lat, opts.lng, opts.zoom);
      const b = tileToBounds(t.x, t.y, opts.zoom);
      const c = tileToCenter(t.x, t.y, opts.zoom);
      const width = tileWidthMeters(opts.zoom, opts.lat);
      console.log(`(${t.x}, ${t.y})  z=${opts.zoom}`);
      console.log(
        `  bounds    W ${b.west.toFixed(6)} / S ${b.south.toFixed(6)} / E ${b.east.toFixed(6)} / N ${b.north.toFixed(6)}`,
      );
      console.log(`  center    ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`);
      console.log(`  width     ${width.toFixed(1)}m`);
    });

  parent
    .command('bounds')
    .description('Bounds of a given (x, y, zoom) tile')
    .requiredOption('--x <n>', 'tile x', (v) => Number.parseInt(v, 10))
    .requiredOption('--y <n>', 'tile y', (v) => Number.parseInt(v, 10))
    .requiredOption('--zoom <z>', 'zoom', (v) => Number.parseInt(v, 10))
    .option('--wkt', 'output PostGIS WKT instead of bbox', false)
    .action((opts) => {
      if (opts.wkt) {
        console.log(tileToBoundsWkt(opts.x, opts.y, opts.zoom));
        return;
      }
      const b = tileToBounds(opts.x, opts.y, opts.zoom);
      console.log(JSON.stringify(b, null, 2));
    });

  parent
    .command('for-bbox')
    .description('Tiles covered by a bbox (W,S,E,N) at zoom')
    .requiredOption('--bbox <w,s,e,n>', '"west,south,east,north" in degrees')
    .requiredOption('--zoom <z>', 'zoom', (v) => Number.parseInt(v, 10))
    .option('--count', 'print count only', false)
    .action((opts) => {
      const parts = (opts.bbox as string).split(',').map(Number);
      if (parts.length !== 4 || parts.some((x) => !Number.isFinite(x))) {
        console.error('invalid --bbox');
        process.exit(1);
        return;
      }
      const [west, south, east, north] = parts as [number, number, number, number];
      const tiles = bboxToTiles({ west, south, east, north }, opts.zoom);
      if (opts.count) {
        console.log(tiles.length);
        return;
      }
      for (const t of tiles) console.log(`${t.x}\t${t.y}`);
      console.error(`(${tiles.length} tiles)`);
    });

  parent
    .command('for-circle')
    .description('Tiles covered by a circle (center + radius meters) at zoom')
    .requiredOption('--lat <n>', 'center latitude', Number.parseFloat)
    .requiredOption('--lng <n>', 'center longitude', Number.parseFloat)
    .requiredOption('--radius <m>', 'radius in meters', Number.parseFloat)
    .requiredOption('--zoom <z>', 'zoom', (v) => Number.parseInt(v, 10))
    .option('--count', 'print count only', false)
    .action((opts) => {
      const poly = circleToPolygon({ lat: opts.lat, lng: opts.lng }, opts.radius);
      const tiles = polygonToTiles(poly, opts.zoom);
      if (opts.count) {
        console.log(tiles.length);
        return;
      }
      for (const t of tiles) console.log(`${t.x}\t${t.y}`);
      console.error(`(${tiles.length} tiles)`);
    });
}
