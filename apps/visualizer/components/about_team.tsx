'use client';

import type { VizProject } from '@/lib/project';
import { useCallback, useState } from 'react';
import { MiniMap } from './mini_map';
import { MAP_BG, useCurtainNav } from './transition';

interface Member {
  name: string;
  role?: string;
  photo: number;
  linkedin?: string;
  twitter?: string;
}

const TEAM: Member[] = [
  {
    name: 'Tiago Trindade',
    role: 'Lead',
    photo: 1,
    linkedin: 'https://www.linkedin.com/in/tiagotrindade03/',
    twitter: 'https://x.com/tiagotrindadeo',
  },
  { name: 'Guilherme Huther', photo: 2, linkedin: 'https://www.linkedin.com/in/guilhermehuther/' },
  { name: 'Clara Dantas', photo: 3, linkedin: 'https://www.linkedin.com/in/claradantast/' },
  {
    name: 'Pedro Ernesto Vogado',
    photo: 4,
    linkedin: 'https://www.linkedin.com/in/pedroernestovogado/',
  },
  {
    name: 'Gabriel (Harry) Carvalho',
    photo: 5,
    linkedin: 'https://www.linkedin.com/in/gabrielcarvvlho/',
    twitter: 'https://x.com/carvvlhogabriel',
  },
  { name: 'Marcus Vinícius', photo: 6, linkedin: 'https://www.linkedin.com/in/marcusvs/' },
];

const TIAGO_X = 'https://x.com/tiagotrindadeo';
const COENEN_X = 'https://x.com/_coenen';
const ISOMETRIC_NYC = 'https://isometric.nyc/';

const LINK =
  'font-semibold text-[#14110c] underline decoration-[#c9c3b5] underline-offset-2 transition-colors hover:decoration-[#14110c]';

/**
 * The "about map.art + the team" content, shared by the home landing (as page
 * sections) and the project viewer's Info drawer. `featured` hangs one project's
 * map under the blurb as a framed miniature that opens it.
 */
export function AboutTeam({ featured }: { featured?: VizProject }) {
  const { go, curtain } = useCurtainNav();

  return (
    <div className="mx-auto max-w-[760px] px-6">
      {curtain}
      <section className="py-24">
        <h2 className="font-pixel text-[34px] text-[#14110c] leading-tight">map.art</h2>
        <div className="mt-6 space-y-4 text-[16px] text-[#4a463e] leading-[1.75]">
          <p>
            map.art turns aerial map tiles into isometric, SimCity-style pixel-art. It&apos;s a work
            in progress: an image model we fine-tuned on hand-made pixel cities, wrapped in a
            pipeline we engineered to render, stylize and stitch map tiles on its own.
          </p>
          <p>
            None of that is tied to a particular city. It works tile by tile, so it scales sideways
            — point it at any coordinates and it renders them, then stacks the result into a
            deep-zoom pyramid you can explore down to the pixel. Given enough compute, it can draw
            the entire world. The globe is every map we&apos;ve made so far, pinned where it was
            made.
          </p>
          <p>
            The inspiration is{' '}
            <a href={COENEN_X} target="_blank" rel="noreferrer" className={LINK}>
              @_coenen
            </a>{' '}
            and his work on{' '}
            <a href={ISOMETRIC_NYC} target="_blank" rel="noreferrer" className={LINK}>
              isometric.nyc
            </a>
            , which does the same thing for New York. map.art is our run at it, built to go
            anywhere.
          </p>
          <p>
            That compute is the hard part: running the models is genuinely expensive. If you want to
            see this keep going, we happily take support, funding — or honestly, just sharing it.
            Come talk to{' '}
            <a href={TIAGO_X} target="_blank" rel="noreferrer" className={LINK}>
              @tiagotrindadeo
            </a>{' '}
            on Twitter.
          </p>
        </div>

        {/* One map hung under the copy, so the page shows what it's describing. */}
        {featured && (
          <button
            type="button"
            onClick={() => go(`/${featured.slug}`, MAP_BG)}
            aria-label={`Open the ${featured.name} map`}
            className="group mt-12 block w-full cursor-pointer border-none bg-transparent p-0 transition-transform duration-200 ease-out hover:-translate-y-1"
          >
            <MiniMap project={featured} />
            <div className="mt-4 font-pixel text-[13px] text-[#8a857a] transition-colors group-hover:text-[#14110c]">
              open the map →
            </div>
          </button>
        )}
      </section>

      <section className="pb-32">
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
  // The pixel portrait is the resting state and much the heavier file, so the
  // photo underneath stays hidden until it has decoded — otherwise the card
  // shows the real face first and snaps to pixels once the PNG lands.
  const [pixelReady, setPixelReady] = useState(false);
  const ready = useCallback((el: HTMLImageElement | null): void => {
    if (el?.complete) setPixelReady(true);
  }, []);

  return (
    <div className="flex flex-col items-center text-center">
      <div className="group relative aspect-square w-full overflow-hidden rounded-2xl border border-black/10 bg-[#f1efe9] shadow-sm">
        <img
          src={`/team/${member.photo}_real.jpg`}
          alt={member.name}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            pixelReady ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <img
          ref={ready}
          src={`/team/${member.photo}.png`}
          alt=""
          onLoad={() => setPixelReady(true)}
          onError={() => setPixelReady(true)}
          className={`absolute inset-0 h-full w-full object-cover [clip-path:inset(0_0_0_0)] transition-[clip-path,opacity] duration-500 ease-out [image-rendering:pixelated] group-hover:[clip-path:inset(0_0_0_100%)] ${
            pixelReady ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>
      <div className="mt-4 flex items-baseline justify-center gap-2">
        <span className="font-pixel text-[18px] text-[#14110c]">{member.name}</span>
        {member.role && <span className="text-[13px] text-[#8a857a]">{member.role}</span>}
      </div>
      <div className="mt-3 flex items-center gap-2">
        {member.linkedin && (
          <Social href={member.linkedin} label={`${member.name} on LinkedIn`}>
            <LinkedInIcon />
          </Social>
        )}
        {member.twitter && (
          <Social href={member.twitter} label={`${member.name} on X`}>
            <XIcon />
          </Social>
        )}
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
