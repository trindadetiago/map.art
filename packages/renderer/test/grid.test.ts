import { describe, expect, it } from 'vitest';
import { gridCells, tileCenterLatLng, tileFootprint } from '../src/params';

const ORIGIN = { lat: 40.7484, lng: -73.9857 }; // arbitrary (Empire State-ish)

describe('gridCells', () => {
  it('produces cols×rows cells in row-major order', () => {
    const cells = gridCells(ORIGIN, 3, 2);
    expect(cells).toHaveLength(6);
    // row-major: (0,0),(1,0),(2,0),(0,1),(1,1),(2,1)
    expect(cells.map((c) => `${c.x},${c.y}`)).toEqual(['0,0', '1,0', '2,0', '0,1', '1,1', '2,1']);
  });

  it('anchors tile (0,0) at the origin', () => {
    const [first] = gridCells(ORIGIN, 2, 2);
    expect(first?.lat).toBeCloseTo(ORIGIN.lat, 10);
    expect(first?.lng).toBeCloseTo(ORIGIN.lng, 10);
  });

  it('gives every cell a distinct, finite center', () => {
    const cells = gridCells(ORIGIN, 4, 4);
    const centers = new Set(cells.map((c) => `${c.lat},${c.lng}`));
    expect(centers.size).toBe(16);
    for (const c of cells) {
      expect(Number.isFinite(c.lat)).toBe(true);
      expect(Number.isFinite(c.lng)).toBe(true);
    }
  });

  it('matches tileCenterLatLng for each (x, y)', () => {
    const cells = gridCells(ORIGIN, 2, 3);
    for (const c of cells) {
      const expected = tileCenterLatLng(ORIGIN, c.x, c.y);
      expect(c.lat).toBe(expected.lat);
      expect(c.lng).toBe(expected.lng);
    }
  });

  it('returns nothing for an empty grid', () => {
    expect(gridCells(ORIGIN, 0, 5)).toHaveLength(0);
    expect(gridCells(ORIGIN, 5, 0)).toHaveLength(0);
  });
});

describe('tileFootprint', () => {
  it('gives 4 distinct, finite corners around the tile center', () => {
    const corners = tileFootprint(ORIGIN, 0, 0);
    expect(corners).toHaveLength(4);
    const center = tileCenterLatLng(ORIGIN, 0, 0);
    for (const c of corners) {
      expect(Number.isFinite(c.lat)).toBe(true);
      expect(Number.isFinite(c.lng)).toBe(true);
      // each corner is within a tile's reach of the center
      expect(Math.abs(c.lat - center.lat)).toBeLessThan(0.01);
      expect(Math.abs(c.lng - center.lng)).toBeLessThan(0.01);
    }
    expect(new Set(corners.map((c) => `${c.lat},${c.lng}`)).size).toBe(4);
  });

  it("a tile's east edge matches its east neighbor's west edge (tiles abut)", () => {
    // ne corner of (0,0) == nw corner of (1,0); se of (0,0) == sw of (1,0)
    const a = tileFootprint(ORIGIN, 0, 0); // [nw, ne, se, sw]
    const b = tileFootprint(ORIGIN, 1, 0);
    expect(a[1]?.lat).toBeCloseTo(b[0]?.lat ?? Number.NaN, 9); // ne == nw
    expect(a[1]?.lng).toBeCloseTo(b[0]?.lng ?? Number.NaN, 9);
    expect(a[2]?.lat).toBeCloseTo(b[3]?.lat ?? Number.NaN, 9); // se == sw
    expect(a[2]?.lng).toBeCloseTo(b[3]?.lng ?? Number.NaN, 9);
  });
});
