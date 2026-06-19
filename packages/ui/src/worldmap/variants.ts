export type WorldMapVariant = 'realistic' | 'pixelated';

export interface WorldMapPalette {
  ocean: string;
  land: string;
  border: string;
}

export interface WorldMapVariantConfig {
  label: string;
  /** Country outline stroke width in px (0 = no stroke). */
  borderWidth: number;
  /** Render-then-upscale block size for the pixel-art look; null = crisp. */
  pixelSize: number | null;
  palette: WorldMapPalette;
}

/**
 * The same Equal Earth map, painted differently — mirrors `GLOBE_VARIANTS`.
 * `realistic` is a smooth shaded map; `pixelated` renders small and scales up
 * with nearest-neighbour for a hard, blocky pixel-art look.
 */
export const WORLDMAP_VARIANTS: Record<WorldMapVariant, WorldMapVariantConfig> = {
  realistic: {
    label: 'Realistic',
    borderWidth: 0.6,
    pixelSize: null,
    palette: {
      ocean: '#16324f',
      land: '#4e8d57',
      border: '#2f5f3b',
    },
  },
  pixelated: {
    label: 'Pixelated',
    borderWidth: 0,
    pixelSize: 6,
    palette: {
      ocean: '#21496b',
      land: '#63b06d',
      border: '#21496b',
    },
  },
};
