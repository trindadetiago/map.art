'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { WorldMapPanel, type WorldProject } from './world_map_panel';

const Globe = dynamic(() => import('@mapart/ui/globe/react').then((m) => m.Globe), {
  ssr: false,
});

interface Member {
  name: string;
  role: string;
  photo: number;
  linkedin: string;
  twitter: string;
}

const TEAM: Member[] = [
  { name: 'Ada Marsh', role: 'Founder', photo: 1, linkedin: '#', twitter: '#' },
  { name: 'Léo Pruitt', role: 'Rendering', photo: 2, linkedin: '#', twitter: '#' },
  { name: 'Mira Okonkwo', role: 'Model / ML', photo: 3, linkedin: '#', twitter: '#' },
  { name: 'Tomás Vidal', role: 'Pipeline', photo: 4, linkedin: '#', twitter: '#' },
  { name: 'Sana Iqbal', role: 'Design', photo: 5, linkedin: '#', twitter: '#' },
  { name: 'Bruno Sato', role: 'Infra', photo: 6, linkedin: '#', twitter: '#' },
];

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * The visualizer landing. A pinned hero whose scroll progress drives a morph:
 * the world map collapses vertically (top+bottom → centre), then the globe
 * expands back out (the reverse). Past the morph, the page scrolls normally into
 * the project blurb and the team. A faint pixel-grid background scrolls behind
 * the pinned hero.
 */
const easeInOut = (x: number): number => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

export function HomeLanding({ projects }: { projects: WorldProject[] }) {
  const heroRef = useRef<HTMLDivElement>(null);
  // Morph progress: 0 = world map, 1 = globe.
  const [t, setT] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const replayRef = useRef(false);

  // Scroll only ever pushes the morph forward (map → globe) — scrolling back up
  // never reverses it, so once the globe is revealed it stays the globe.
  useEffect(() => {
    let raf = 0;
    const update = (): void => {
      raf = 0;
      if (replayRef.current) return;
      const hero = heroRef.current;
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const prog = span > 0 ? clamp01(-rect.top / span) : 0;
      setT((cur) => Math.max(cur, prog));
    };
    const onScroll = (): void => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Clicking the globe replays the whole morph (map appears, collapses, globe
  // expands) as a one-shot tween, independent of scroll.
  const replay = (): void => {
    if (replayRef.current) return;
    replayRef.current = true;
    setReplaying(true);
    const dur = 1200;
    let start = 0;
    const tick = (now: number): void => {
      if (!start) start = now;
      const k = clamp01((now - start) / dur);
      setT(easeInOut(k));
      if (k < 1) requestAnimationFrame(tick);
      else {
        replayRef.current = false;
        setReplaying(false);
      }
    };
    requestAnimationFrame(tick);
  };

  // Map collapses over the first ~45%; the globe expands over the last ~45%,
  // with a brief "closed" beat at the midpoint where both are a flat line.
  const collapse = clamp01(t / 0.45);
  const expand = clamp01((t - 0.5) / 0.45);
  const mapScaleY = 1 - collapse;
  const mapOpacity = 1 - clamp01(t / 0.42);
  const hint = 1 - clamp01(t / 0.12);
  const globeActive = expand > 0.99 && !replaying;

  return (
    <div className="relative bg-white text-[#1a1714]">
      <div className="pixel-grid pointer-events-none absolute inset-0 -z-10" />

      {/* Pinned hero: tall so there's scroll distance to drive the morph. */}
      <section ref={heroRef} className="relative h-[240vh]">
        <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden">
          {/* World map — collapses from top+bottom to a centre line. */}
          <div
            className="absolute h-[min(70vh,520px)] w-[min(86vw,1040px)]"
            style={{
              transform: `scaleY(${mapScaleY})`,
              opacity: mapOpacity,
              pointerEvents: collapse > 0.15 || replaying ? 'none' : 'auto',
            }}
          >
            <WorldMapPanel projects={projects} />
          </div>

          {/* Globe — expands back out (the reverse of the collapse). Clicking it
              replays the morph; it lifts + glows on hover. */}
          <div
            className="absolute aspect-square h-[min(70vh,520px)]"
            style={{ transform: `scaleY(${expand})`, opacity: expand }}
          >
            <button
              type="button"
              onClick={replay}
              title="Replay"
              aria-label="Replay the intro"
              className="group block h-full w-full cursor-pointer border-none bg-transparent p-0 transition-transform duration-200 hover:scale-[1.04]"
              style={{ pointerEvents: globeActive ? 'auto' : 'none' }}
            >
              <div className="h-full w-full transition-[filter] duration-200 group-hover:[filter:drop-shadow(0_10px_30px_rgba(90,160,224,0.5))]">
                <Globe
                  variant="pixelated"
                  pixelSize={6}
                  interactive={false}
                  className="h-full w-full"
                />
              </div>
            </button>
          </div>

          <div
            className="pointer-events-none absolute bottom-8 flex flex-col items-center gap-1 text-[#8a857a]"
            style={{ opacity: hint }}
          >
            <span className="font-pixel text-[13px]">scroll</span>
            <span className="text-[18px] leading-none">↓</span>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="mx-auto max-w-[760px] px-6 py-24">
        <h2 className="font-pixel text-[34px] text-[#14110c] leading-tight">map.art</h2>
        <div className="mt-6 space-y-4 text-[16px] text-[#4a463e] leading-[1.75]">
          <p>
            map.art turns aerial map tiles into isometric, SimCity-style pixel-art. Pick an area on
            a map and get back a stylized, zoomable version of it — every block hand-rendered by a
            model trained on real cities.
          </p>
          <p>
            Each project is rendered tile by tile, stylized, and stitched into a deep-zoom pyramid
            you can explore down to the pixel. The globe above is every map we&apos;ve made, pinned
            where it was made.
          </p>
        </div>
      </section>

      {/* Team — same container width as the about section. */}
      <section className="mx-auto max-w-[760px] px-6 pb-32">
        <h2 className="font-pixel text-[28px] text-[#14110c]">the team</h2>
        <div className="mt-10 grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-3">
          {TEAM.map((m) => (
            <TeamCard key={m.name} member={m} />
          ))}
        </div>
      </section>
    </div>
  );
}

function TeamCard({ member }: { member: Member }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="group relative aspect-square w-full overflow-hidden rounded-2xl border border-black/10 bg-[#f1efe9] shadow-sm">
        <img
          src={`/team/${member.photo}_real.jpg`}
          alt={member.name}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <img
          src={`/team/${member.photo}_pixel.jpg`}
          alt=""
          className="absolute inset-0 h-full w-full object-cover [clip-path:inset(0_0_0_0)] transition-[clip-path] duration-500 ease-out [image-rendering:pixelated] group-hover:[clip-path:inset(0_0_0_100%)]"
        />
      </div>
      <div className="mt-4 font-pixel text-[18px] text-[#14110c]">{member.name}</div>
      <div className="text-[13px] text-[#8a857a]">{member.role}</div>
      <div className="mt-3 flex items-center gap-2">
        <Social href={member.linkedin} label={`${member.name} on LinkedIn`}>
          <LinkedInIcon />
        </Social>
        <Social href={member.twitter} label={`${member.name} on X`}>
          <XIcon />
        </Social>
      </div>
    </div>
  );
}

function Social({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      target="_blank"
      rel="noreferrer"
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-white text-[#4a463e] transition-colors hover:border-black/30 hover:text-[#14110c]"
    >
      {children}
    </a>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05C20.4 8.65 21 11 21 14.1V21h-4v-6.1c0-1.45-.03-3.3-2-3.3-2 0-2.3 1.57-2.3 3.2V21H9z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M18.24 2H21l-6.56 7.5L22 22h-6.4l-5-6.54L4.8 22H2l7-8.02L2 2h6.56l4.52 5.98zm-1.12 18h1.7L7.02 3.74H5.2z" />
    </svg>
  );
}
