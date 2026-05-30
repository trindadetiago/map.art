import { describe, expect, it } from 'vitest';
import { gridCells, tileCenterLatLng } from '../src/params';

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
