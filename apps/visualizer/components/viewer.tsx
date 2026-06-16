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
        // A custom tile source rather than the legacy DZI `{ Image }` descriptor:
        // OSD's built-in DZI getTileUrl concatenates `fileFormat + queryParams`,
        // and the minified bundle appends a literal "undefined" (queryParams is
        // unset for the object form) → every tile 404s. Owning getTileUrl
        // sidesteps that entirely. Levels/tile grid are computed from the
        // dimensions exactly like DZI, so they line up with the libvips pyramid.
        tileSources: {
          width: meta.width,
          height: meta.height,
          tileSize: meta.tileSize,
          tileOverlap: meta.overlap,
          getTileUrl: (level: number, x: number, y: number) =>
            `${base}/tiles_files/${level}/${x}_${y}.${meta.format}`,
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
