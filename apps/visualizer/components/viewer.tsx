'use client';

import type { VizMetadata } from '@mapart/export/types';
import type OpenSeadragon from 'openseadragon';
import { useEffect, useRef } from 'react';

/**
 * The whole viewer: one OpenSeadragon instance over a project's DZI/WebP
 * pyramid. There is no scene and no camera here — the isometric look is baked
 * into the pixels offline, so at view time this is just a deep-zoom raster.
 *
 * The crispness settings are load-bearing: pixel-art dies under bilinear
 * smoothing, so smoothing is off and over-zoom is nearest-neighbour, letting you
 * zoom past 1:1 to inspect individual pixels without blur.
 */
export function Viewer({ projectId, meta }: { projectId: string; meta: VizMetadata }) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    let viewer: OpenSeadragon.Viewer | null = null;
    let cancelled = false;

    // OpenSeadragon touches `window` at module load, so pull it in only in the
    // browser, after mount.
    void import('openseadragon').then(({ default: OpenSeadragon }) => {
      if (cancelled) return;

      const base = `/api/viz/${projectId}`;
      // `subPixelRoundingForTransparency` is a real runtime option the bundled
      // @types are behind on, so widen the option type to allow it.
      const options: OpenSeadragon.Options & { subPixelRoundingForTransparency?: number } = {
        element: el,
        prefixUrl: '',
        showNavigationControl: false,
        showNavigator: true,
        navigatorSizeRatio: 0.15,
        navigatorBackground: '#16140f',
        // Pixel-art crispness — mirrors the isometric.nyc recipe.
        imageSmoothingEnabled: false,
        smoothTileEdgesMinZoom: Number.POSITIVE_INFINITY,
        subPixelRoundingForTransparency: 1,
        // Let people zoom past native resolution; with smoothing off, magnified
        // pixels stay sharp (nearest-neighbour) instead of turning to mush.
        maxZoomPixelRatio: 8,
        minZoomImageRatio: 0.7,
        visibilityRatio: 1,
        gestureSettingsMouse: { clickToZoom: false },
        tileSources: {
          Image: {
            xmlns: 'http://schemas.microsoft.com/deepzoom/2008',
            Url: `${base}/tiles_files/`,
            Format: meta.format,
            Overlap: String(meta.overlap),
            TileSize: String(meta.tileSize),
            Size: { Width: String(meta.width), Height: String(meta.height) },
          },
        },
      };
      viewer = OpenSeadragon(options);
    });

    return () => {
      cancelled = true;
      viewer?.destroy();
    };
  }, [projectId, meta]);

  return <div ref={elRef} className="viewer" />;
}
