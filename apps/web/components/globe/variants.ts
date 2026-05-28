export type GlobeVariant = 'realistic' | 'pixelated';

export interface GlobePalette {
  ocean: string;
  land: string;
  border: string;
  atmosphere: string;
}

export interface GlobeVariantConfig {
  label: string;
  /** Equirectangular texture the sphere is painted with. */
  texture: { width: number; height: number; borderWidth: number };
  /** Lit phong material + lights, vs. flat unlit basic material. */
  lit: boolean;
  /** Default light intensities (used when lit). */
  light: { ambient: number; key: number };
  /** Fresnel glow shell behind the globe. */
  atmosphere: boolean;
  /** RenderPixelatedPass block size in screen pixels; null disables the pass. */
  pixelSize: number | null;
  palette: GlobePalette;
}

/**
 * The same geometry, painted differently. Add a key here to add a variant —
 * the component reads everything it needs from this config, and every field
 * can be overridden per-instance via props on <Globe>.
 */
export const GLOBE_VARIANTS: Record<GlobeVariant, GlobeVariantConfig> = {
  realistic: {
    label: 'Realistic',
    texture: { width: 2048, height: 1024, borderWidth: 0.75 },
    lit: true,
    light: { ambient: 0.6, key: 1.1 },
    atmosphere: true,
    pixelSize: null,
    palette: {
      ocean: '#16324f',
      land: '#4e8d57',
      border: '#2f5f3b',
      atmosphere: '#5aa0e0',
    },
  },
  pixelated: {
    label: 'Pixelated',
    texture: { width: 512, height: 256, borderWidth: 0 },
    lit: false,
    light: { ambient: 1, key: 0 },
    atmosphere: false,
    pixelSize: 6,
    palette: {
      ocean: '#21496b',
      land: '#63b06d',
      border: '#21496b',
      atmosphere: '#5aa0e0',
    },
  },
};
