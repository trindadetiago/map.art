'use client';

import type { VizMetadata, VizPin } from '@mapart/export/types';
import { type CSSProperties, useState } from 'react';
import { Viewer } from './viewer';

const frameBtn = (active: boolean): string =>
  `inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[9px] border text-[15px] leading-none no-underline backdrop-blur-[6px] transition-colors ${
    active
      ? 'border-[#e4c879] bg-[#e4c879] text-[#1c160c]'
      : 'border-[rgba(234,230,220,0.14)] bg-[rgba(12,11,10,0.72)] text-[#eae6dc] hover:border-[rgba(234,230,220,0.4)]'
  }`;

// Gilded moulding, mat lines, and the brass placard: gradients + multi-layer
// shadows that don't read well as utility classes, so they stay inline.
const frameStyle: CSSProperties = {
  borderImageSource: 'linear-gradient(135deg,#efd99a,#b07f2c 30%,#6f4e16 55%,#e7cd86 80%,#936a22)',
  borderImageSlice: 1,
  boxShadow:
    '0 0 0 1px rgba(0,0,0,0.6), 0 24px 60px -18px rgba(0,0,0,0.8), inset 0 0 0 2px rgba(0,0,0,0.35)',
};
const matteStyle: CSSProperties = {
  boxShadow: '0 0 0 1px rgba(0,0,0,0.7), inset 0 0 0 3px #e9e2cf, inset 0 0 0 4px rgba(0,0,0,0.5)',
};
const placardStyle: CSSProperties = {
  background: 'linear-gradient(180deg,#e4c879,#b8923f)',
  boxShadow: '0 6px 16px -6px rgba(0,0,0,0.8)',
};

/**
 * Museum/gallery chrome around the deep-zoom map: the pixel-art sits matted in a
 * gilded frame on a dark wall, with a brass placard (name · year) and a control
 * cluster — home (back to the globe), a pins toggle, and a "more information"
 * drawer carrying the full description + export stats.
 */
export function Frame({
  projectId,
  meta,
  pins,
  name,
  year,
  description,
}: {
  projectId: string;
  meta: VizMetadata;
  pins: VizPin[];
  name: string;
  year: number | null;
  description: string | null;
}) {
  const [showPins, setShowPins] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <div className="fixed inset-0 flex bg-[radial-gradient(120%_90%_at_50%_38%,#1a1814_0%,#0c0b0a_70%)]">
      <div
        className="relative m-[clamp(18px,4.5vmin,64px)] flex-1 rounded-[3px] border-[clamp(10px,1.8vmin,22px)] border-[#b8923f] border-solid bg-[#0c0b0a] p-[clamp(10px,1.4vmin,18px)]"
        style={frameStyle}
      >
        <div
          className="absolute inset-[clamp(10px,1.4vmin,18px)] overflow-hidden bg-[#0c0b0a]"
          style={matteStyle}
        >
          <Viewer projectId={projectId} meta={meta} pins={pins} showPins={showPins} />
        </div>

        <div
          className="-translate-x-1/2 absolute bottom-[clamp(-22px,-1.6vmin,-14px)] left-1/2 z-20 inline-flex max-w-[80vw] items-baseline gap-2.5 overflow-hidden whitespace-nowrap rounded-md border border-black/30 px-[18px] py-[7px] text-[#1c160c]"
          style={placardStyle}
        >
          <span className="font-[650] text-[14px] tracking-[0.01em]">{name}</span>
          {year !== null && <span className="text-[12px] text-[#4a3a18] tabular-nums">{year}</span>}
        </div>
      </div>

      <div className="fixed top-[18px] left-[18px] z-30 flex gap-2">
        <a href="/" className={frameBtn(false)} title="Back to globe" aria-label="Back to globe">
          ⌂
        </a>
      </div>

      <div className="fixed top-[18px] right-[18px] z-30 flex gap-2">
        {pins.length > 0 && (
          <button
            type="button"
            className={frameBtn(showPins)}
            onClick={() => setShowPins((v) => !v)}
            title={showPins ? 'Hide pins' : 'Show pins'}
          >
            ◉
          </button>
        )}
        <button
          type="button"
          className={frameBtn(infoOpen)}
          onClick={() => setInfoOpen((v) => !v)}
          title="More information"
        >
          ℹ
        </button>
      </div>

      {infoOpen && (
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: click-away backdrop */}
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setInfoOpen(false)} />
          <aside className="fixed top-0 right-0 z-50 h-full w-[min(380px,88vw)] overflow-y-auto border-[rgba(234,230,220,0.12)] border-l bg-[#16140f] px-6 py-[22px] shadow-[-20px_0_50px_-20px_rgba(0,0,0,0.8)]">
            <div className="flex items-start justify-between gap-3">
              <h2 className="m-0 font-[650] text-[18px]">{name}</h2>
              <button
                type="button"
                className="h-7 w-7 shrink-0 cursor-pointer rounded-lg border border-[rgba(234,230,220,0.14)] bg-transparent text-[#9a9385] hover:text-[#eae6dc]"
                onClick={() => setInfoOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {year !== null && (
              <div className="mt-0.5 text-[13px] text-[#d8be7e] tabular-nums">{year}</div>
            )}
            <p
              className={`mt-3.5 text-[14px] leading-[1.6] ${description ? 'text-[#d6d0c2]' : 'text-[#6f695c]'}`}
            >
              {description ?? 'No description yet.'}
            </p>
            <dl className="mt-5 grid gap-2.5 border-[rgba(234,230,220,0.1)] border-t pt-4 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-[#9a9385]">Grid</dt>
                <dd className="m-0 text-[#eae6dc] tabular-nums">
                  {meta.gridWidth}×{meta.gridHeight} tiles
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#9a9385]">Resolution</dt>
                <dd className="m-0 text-[#eae6dc] tabular-nums">
                  {meta.width.toLocaleString()}×{meta.height.toLocaleString()} px
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#9a9385]">Source</dt>
                <dd className="m-0 text-[#eae6dc]">{meta.source}</dd>
              </div>
            </dl>
          </aside>
        </>
      )}
    </div>
  );
}
