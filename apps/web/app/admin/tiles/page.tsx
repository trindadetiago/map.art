import { TilesPanel } from './panel';

export default function TilesDebugPage() {
  return (
    <div>
      <div className="mb-8 flex items-baseline gap-4">
        <h1 className="m-0 text-3xl font-light tracking-tight text-stone-900">Tiles</h1>
        <span className="text-sm text-stone-500">Web-mercator tile math</span>
      </div>
      <p className="mb-8 max-w-[640px] text-[13px] leading-relaxed text-stone-500">
        Pick a bbox or circle + zoom; the overlay shows every tile that would be seeded into a
        project's grid at that zoom.
      </p>
      <TilesPanel />
    </div>
  );
}
