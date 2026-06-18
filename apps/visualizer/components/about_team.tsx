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

/**
 * The "about map.art + the team" content, shared by the home landing (as page
 * sections) and the project viewer's Info drawer.
 */
export function AboutTeam() {
  return (
    <div className="mx-auto max-w-[760px] px-6">
      <section className="py-24">
        <h2 className="font-pixel text-[34px] text-[#14110c] leading-tight">map.art</h2>
        <div className="mt-6 space-y-4 text-[16px] text-[#4a463e] leading-[1.75]">
          <p>
            map.art turns aerial map tiles into isometric, SimCity-style pixel-art. Pick an area on
            a map and get back a stylized, zoomable version of it — every block hand-rendered by a
            model trained on real cities.
          </p>
          <p>
            Each project is rendered tile by tile, stylized, and stitched into a deep-zoom pyramid
            you can explore down to the pixel. The globe is every map we&apos;ve made, pinned where
            it was made.
          </p>
        </div>
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
