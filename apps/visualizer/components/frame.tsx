'use client';

import type { VizProject } from '@/lib/project';
import type { VizMetadata, VizPin } from '@mapart/export/types';
import { type CSSProperties, useEffect, useState } from 'react';
import { AboutTeam } from './about_team';
import { OUTLINE, brassPlate, creamMat, goldFrame } from './frame_style';
import { HOME_BG, MAP_BG, PageFade, useCurtainNav } from './transition';
import { Viewer } from './viewer';

const wallStyle: CSSProperties = {
  background: 'radial-gradient(120% 110% at 50% -5%, #2a241c 0%, #15110c 55%, #0a0807 100%)',
};
const frameStyle = goldFrame(6, '0 30px 70px -30px rgba(0,0,0,0.85)');
const matStyle = creamMat(2);

const CTRL =
  'inline-flex h-9 select-none items-center gap-1.5 px-3 font-pixel text-[12px] transition-none';
const ctrlStyle = (active: boolean): CSSProperties => ({
  background: active ? '#d8b75e' : '#1b140b',
  color: active ? '#1c160c' : '#e9cd7e',
  boxShadow: [
    `0 0 0 2px ${OUTLINE}`,
    `inset 2px 2px 0 0 ${active ? '#f0d98e' : '#3a2c14'}`,
    `inset -2px -2px 0 0 ${active ? '#8a6a26' : '#000'}`,
  ].join(', '),
});

/**
 * Museum/gallery chrome around the deep-zoom map: the pixel-art hangs in a
 * pixel-bevelled gold frame with a cream mat on a spotlit wall, an engraved
 * brass nameplate, and labelled controls — Home (back to the globe), Pins
 * (toggle the map markers), and Info (the about-the-project + team overlay,
 * same content as the home page).
 */
export function Frame({
  tileBaseUrl,
  meta,
  pins,
  name,
  year,
  featured,
}: {
  tileBaseUrl: string;
  meta: VizMetadata;
  pins: VizPin[];
  name: string;
  year: number | null;
  featured?: VizProject;
}) {
  const [showPins, setShowPins] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  // The overlay mounts once the viewer has had the network to itself for a
  // beat, so its portraits are already decoded by the time Info is clicked —
  // opening it then costs nothing but the fade.
  const [infoReady, setInfoReady] = useState(false);
  const { go, curtain } = useCurtainNav();

  useEffect(() => {
    const id = window.setTimeout(() => setInfoReady(true), 2000);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="fixed inset-0 flex" style={wallStyle}>
      <PageFade color={MAP_BG} />
      {curtain}
      <figure className="relative flex flex-1 p-[clamp(12px,1.8vmin,24px)]" style={frameStyle}>
        <div className="h-full w-full p-[clamp(6px,1.1vmin,14px)]" style={matStyle}>
          <div className="relative h-full w-full overflow-hidden border-[3px] border-[#241a09] bg-[#0c0b0a]">
            <Viewer tileBaseUrl={tileBaseUrl} meta={meta} pins={pins} showPins={showPins} />
          </div>
        </div>

        {/* Engraved brass nameplate resting near the bottom of the mat. */}
        <figcaption
          className="-translate-x-1/2 absolute bottom-[clamp(20px,3.5vmin,48px)] left-1/2 z-20 flex items-baseline gap-2 px-4 py-1.5"
          style={brassPlate}
        >
          <span
            className="font-pixel text-[14px] text-[#2c2008]"
            style={{ textShadow: '0 1px 0 rgba(255,255,255,0.35)' }}
          >
            {name}
          </span>
          {year !== null && <span className="text-[12px] text-[#5a4718] tabular-nums">{year}</span>}
        </figcaption>
      </figure>

      {/* Controls — labelled so they're self-explanatory, styled like the frame. */}
      <div className="fixed top-5 left-5 z-30">
        <a
          href="/"
          className={CTRL}
          style={ctrlStyle(false)}
          aria-label="Back to globe"
          onClick={(e) => {
            e.preventDefault();
            go('/', HOME_BG);
          }}
        >
          <HomeIcon />
          Home
        </a>
      </div>

      <div className="fixed top-5 right-5 z-30 flex gap-2">
        {pins.length > 0 && (
          <button
            type="button"
            className={CTRL}
            style={ctrlStyle(showPins)}
            onClick={() => setShowPins((v) => !v)}
          >
            <PinIcon />
            Pins
          </button>
        )}
        <button
          type="button"
          className={CTRL}
          style={ctrlStyle(infoOpen)}
          onClick={() => setInfoOpen((v) => !v)}
        >
          <InfoIcon />
          Info
        </button>
      </div>

      {/* Info overlay — the same about + team content as the home page. Once
          mounted it stays mounted and only fades, so reopening is instant. */}
      {(infoReady || infoOpen) && (
        <div
          className={`fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-white transition-opacity duration-300 ease-out ${
            infoOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          inert={!infoOpen}
        >
          <button
            type="button"
            className={`${CTRL} fixed top-5 right-5 z-10`}
            style={ctrlStyle(false)}
            onClick={() => setInfoOpen(false)}
          >
            ✕ Close
          </button>
          <AboutTeam {...(featured ? { featured } : {})} />
        </div>
      )}
    </div>
  );
}

function HomeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.5h.01" />
    </svg>
  );
}
