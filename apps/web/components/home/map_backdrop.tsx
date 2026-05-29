const INK = '#171717';
const WATER = '#21496b';

const ROUTES: { d: string; w: number; dur: string }[] = [
  { d: 'M-80 180 C 240 120 460 360 760 320 S 1320 260 1540 320', w: 1.5, dur: '7s' },
  { d: 'M-80 640 C 200 580 380 680 640 620 S 1200 540 1540 620', w: 1.5, dur: '9s' },
  { d: 'M 420 -60 C 500 220 360 470 470 720 S 520 1000 520 1000', w: 1.25, dur: '11s' },
  { d: 'M 980 -60 C 900 240 1090 470 1000 760', w: 1.25, dur: '8s' },
];

const MARKERS: { x: number; y: number; delay: string }[] = [
  { x: 760, y: 320, delay: '0s' },
  { x: 640, y: 620, delay: '1.6s' },
  { x: 1000, y: 470, delay: '3.1s' },
  { x: 300, y: 250, delay: '2.2s' },
];

const TICKS: [number, number][] = [
  [180, 760],
  [600, 180],
  [1180, 720],
  [840, 560],
  [360, 500],
];

export function MapBackdrop() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-map-backdrop
      aria-hidden="true"
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <pattern id="map-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0H0V48" stroke={INK} strokeWidth="1" strokeOpacity="0.04" />
          </pattern>
          <pattern id="map-grid-coarse" width="240" height="240" patternUnits="userSpaceOnUse">
            <path d="M240 0H0V240" stroke={INK} strokeWidth="1" strokeOpacity="0.05" />
          </pattern>
        </defs>

        <g style={{ animation: 'map-drift 40s linear infinite' }}>
          <rect x="-48" y="-48" width="1536" height="996" fill="url(#map-grid)" />
        </g>
        <rect width="1440" height="900" fill="url(#map-grid-coarse)" />

        <path
          d="M-80 420 C 320 380 760 480 1540 420"
          stroke={WATER}
          strokeOpacity="0.06"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        <g stroke={INK} strokeOpacity="0.06" strokeLinecap="round">
          {ROUTES.map((r) => (
            <path
              key={r.d}
              d={r.d}
              strokeWidth={r.w}
              strokeDasharray="6 10"
              style={{ animation: `map-dash ${r.dur} linear infinite` }}
            />
          ))}
        </g>

        <g stroke={INK} strokeOpacity="0.07" strokeWidth="1">
          {TICKS.map(([x, y]) => (
            <path key={`${x}-${y}`} d={`M${x - 6} ${y}h12 M${x} ${y - 6}v12`} />
          ))}
        </g>

        {MARKERS.map((m) => (
          <g key={`${m.x}-${m.y}`}>
            <circle cx={m.x} cy={m.y} r="2.5" fill={WATER} fillOpacity="0.16" />
            <circle
              cx={m.x}
              cy={m.y}
              r="9"
              fill="none"
              stroke={WATER}
              strokeWidth="1.25"
              strokeOpacity="0.16"
              style={{
                animation: `map-ping 5s ease-out ${m.delay} infinite`,
                transformBox: 'fill-box',
                transformOrigin: 'center',
              }}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
