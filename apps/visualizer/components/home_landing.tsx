'use client';

import type { VizProject } from '@/lib/project';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { AboutTeam } from './about_team';
import { HOME_BG, MAP_BG, PageFade, useCurtainNav } from './transition';
import { WorldMapPanel } from './world_map_panel';

const Globe = dynamic(() => import('@mapart/ui/globe/react').then((m) => m.Globe), {
  ssr: false,
});

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * The visualizer landing. A pinned hero whose scroll progress drives a morph:
 * the world map collapses vertically (top+bottom → centre), then the globe
 * expands back out (the reverse). Past the morph, the page scrolls normally into
 * the project blurb and the team. A faint pixel-grid background scrolls behind
 * the pinned hero.
 */
const easeInOut = (x: number): number => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

export function HomeLanding({ projects }: { projects: VizProject[] }) {
  // The curtain lives at the landing root: the hero panels are `transform`ed,
  // and a transformed ancestor would trap a `position: fixed` child inside it.
  const { go, curtain } = useCurtainNav();
  const heroRef = useRef<HTMLDivElement>(null);
  // Morph progress: 0 = world map, 1 = globe.
  const [t, setT] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const replayRef = useRef(false);
  // Once the user clicks to switch map/globe, scroll stops driving the morph —
  // from then on it's click-only (click globe → map, click map → globe).
  const [manual, setManual] = useState(false);
  const manualRef = useRef(false);

  // Scroll drives the morph both ways: down collapses the map into the globe, up
  // expands it back out. A click takes the wheel for good — after one, scroll no
  // longer drives it, so the state you clicked into is the state that stays.
  useEffect(() => {
    let raf = 0;
    const update = (): void => {
      raf = 0;
      if (replayRef.current || manualRef.current) return;
      const hero = heroRef.current;
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const prog = span > 0 ? clamp01(-rect.top / span) : 0;
      setT(prog);
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

  // Animate the morph to a target (0 = map, 1 = globe) as a one-shot tween.
  const tweenTo = (target: number): void => {
    if (replayRef.current) return;
    replayRef.current = true;
    setReplaying(true);
    const from = t;
    const dur = 900;
    let start = 0;
    const tick = (now: number): void => {
      if (!start) start = now;
      const k = clamp01((now - start) / dur);
      setT(from + (target - from) * easeInOut(k));
      if (k < 1) requestAnimationFrame(tick);
      else {
        replayRef.current = false;
        setReplaying(false);
      }
    };
    requestAnimationFrame(tick);
  };

  // Clicking the globe opens the map (and hands control to clicks); clicking the
  // map goes back to the globe.
  const openMap = (): void => {
    manualRef.current = true;
    setManual(true);
    tweenTo(0);
  };
  const openGlobe = (): void => tweenTo(1);

  // Map collapses over the first ~45%; the globe expands over the last ~45%,
  // with a brief "closed" beat at the midpoint where both are a flat line.
  const collapse = clamp01(t / 0.45);
  const expand = clamp01((t - 0.5) / 0.45);
  const mapScaleY = 1 - collapse;
  const mapOpacity = 1 - clamp01(t / 0.42);
  const hint = 1 - clamp01(t / 0.12);
  const globeActive = expand > 0.99 && !replaying;

  return (
    <div className="home-page relative bg-white text-[#1a1714]">
      <PageFade color={HOME_BG} />
      {curtain}
      <div className="pixel-grid pointer-events-none absolute inset-0 -z-10" />

      {/* Pinned hero: tall so there's scroll distance to drive the morph. */}
      <section ref={heroRef} className="relative h-[240vh]">
        <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden">
          {/* World map — collapses from top+bottom to a centre line. Once in
              manual mode, clicking empty map (not a pin) returns to the globe. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: globe toggle is also reachable by clicking the globe */}
          <div
            className={`absolute h-[min(70vh,520px)] w-[min(86vw,1040px)] ${manual ? 'cursor-pointer' : ''}`}
            style={{
              transform: `scaleY(${mapScaleY})`,
              opacity: mapOpacity,
              pointerEvents: collapse > 0.15 || replaying ? 'none' : 'auto',
            }}
            onClick={manual ? openGlobe : undefined}
          >
            <WorldMapPanel projects={projects} onOpenProject={(slug) => go(`/${slug}`, MAP_BG)} />
          </div>

          {/* Globe — expands back out (the reverse of the collapse). Clicking it
              opens the world map; it lifts on hover. */}
          <div
            className="absolute aspect-square h-[min(70vh,86vw,520px)]"
            style={{ transform: `scaleY(${expand})`, opacity: expand }}
          >
            <button
              type="button"
              onClick={openMap}
              title="Open the world map"
              aria-label="Open the world map"
              className="group block h-full w-full cursor-pointer border-none bg-transparent p-0 transition-transform duration-200 hover:scale-[1.04]"
              style={{ pointerEvents: globeActive ? 'auto' : 'none' }}
            >
              <div className="h-full w-full">
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

      <AboutTeam {...(projects[0] ? { featured: projects[0] } : {})} />
    </div>
  );
}
