'use client';

import type { VizProject } from '@/lib/project';
import { brassPlate, creamMat, goldFrame } from './frame_style';

/**
 * A project's whole map as one framed thumbnail — the gallery chrome shrunk to
 * a card. It's a single pyramid tile, so it costs one request and stays crisp:
 * the art is pixel-art, and upscaling it with nearest-neighbour reads as the
 * medium rather than as a blurry preview.
 *
 * `size` picks the bevel weights so the miniature holds together both as a
 * full-width card under the about copy and as a pin's hover peek.
 */
export function MiniMap({
  project,
  size = 'card',
}: {
  project: VizProject;
  size?: 'card' | 'peek';
}) {
  const card = size === 'card';
  return (
    <div
      className={`relative ${card ? 'p-2.5 pb-9' : 'p-1.5 pb-7'}`}
      style={goldFrame(
        card ? 5 : 3,
        card ? '0 22px 50px -26px rgba(0,0,0,0.85)' : '0 12px 28px -12px rgba(0,0,0,0.9)',
      )}
    >
      <div className={card ? 'p-2.5' : 'p-1.5'} style={creamMat(card ? 4 : 2)}>
        <img
          src={project.thumbUrl}
          alt={`${project.name} rendered as pixel-art`}
          style={{ aspectRatio: project.aspect }}
          className="block w-full border-[3px] border-[#241a09] bg-[#0c0b0a] object-cover [image-rendering:pixelated]"
        />
      </div>

      {/* Engraved nameplate, resting on the moulding below the mat. */}
      <div
        className={`-translate-x-1/2 absolute left-1/2 flex items-baseline gap-1.5 ${
          card ? 'bottom-1.5 px-3 py-1' : 'bottom-1 px-2 py-0.5'
        }`}
        style={brassPlate}
      >
        <span
          className={`font-pixel text-[#2c2008] ${card ? 'text-[13px]' : 'text-[11px]'}`}
          style={{ textShadow: '0 1px 0 rgba(255,255,255,0.35)' }}
        >
          {project.name}
        </span>
        {project.year !== null && (
          <span className={`text-[#5a4718] tabular-nums ${card ? 'text-[11px]' : 'text-[10px]'}`}>
            {project.year}
          </span>
        )}
      </div>
    </div>
  );
}
