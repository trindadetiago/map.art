'use client';

import { latLngToImagePoint } from '@/lib/geo';
import type { VizMetadata, VizPin } from '@mapart/export/types';
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
export function Viewer({
  projectId,
  meta,
  pins = [],
  showPins = true,
}: {
  projectId: string;
  meta: VizMetadata;
  pins?: VizPin[];
  showPins?: boolean;
}) {
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
        // Bottom-right keeps the minimap clear of the Pins/Info controls, which
        // sit over the top-right corner of the frame.
        navigatorPosition: 'BOTTOM_RIGHT',
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

      // Pins are placed by image point, so they hold a constant screen size and
      // their position tracks pan/zoom for free. They need the tiled image's
      // dimensions, so wait for `open` before converting coordinates.
      if (pins.length > 0) {
        const v = viewer;
        v.addOnceHandler('open', () => {
          for (const pin of pins) {
            const pt = latLngToImagePoint(meta, pin.lat, pin.lng);
            if (!pt) continue;
            v.addOverlay({
              element: createPinElement(pin),
              location: v.viewport.imageToViewportCoordinates(new OpenSeadragon.Point(pt.x, pt.y)),
              placement: OpenSeadragon.Placement.BOTTOM,
              checkResize: false,
            });
          }
        });
      }
    });

    return () => {
      cancelled = true;
      viewer?.destroy();
    };
  }, [projectId, meta, pins]);

  // Toggling pins only flips this class; the effect doesn't depend on showPins,
  // so the (expensive) OSD instance and its overlays are never rebuilt — CSS
  // hides the markers in place.
  return (
    <div
      ref={elRef}
      className={`viewer h-full w-full bg-[#0c0b0a]${showPins ? '' : ' viz-pins-hidden'}`}
    />
  );
}

/** Build a pin overlay: a marker dot with a label that reveals on hover. The
 * element's bottom-centre is the geo point (it's added with `BOTTOM` placement),
 * so the dot sits exactly on the location.
 *
 * OpenSeadragon forces the overlay root to `display: block`, which would lay the
 * label and dot out side by side — the flex column lives on an inner wrapper it
 * doesn't touch. */
function createPinElement(pin: VizPin): HTMLElement {
  const root = document.createElement('div');
  root.className = 'viz-pin';
  if (pin.kind) root.dataset.kind = pin.kind;
  root.title = pin.label;

  const inner = document.createElement('div');
  inner.className = 'viz-pin-inner';

  const label = document.createElement('span');
  label.className = 'viz-pin-label';
  label.textContent = pin.label;

  const dot = document.createElement('span');
  dot.className = 'viz-pin-dot';

  inner.append(label, dot);
  root.append(inner);
  return root;
}
