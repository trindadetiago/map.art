import { TilesPanel } from './panel';

export default function TilesDebugPage() {
  return (
    <div>
      <h1 className="mt-0">tiles</h1>
      <p className="max-w-[640px] opacity-70">
        Web-mercator tile math. Pick a bbox or circle + zoom; the SVG overlay shows every tile that
        would be seeded into a project's grid at that zoom.
      </p>
      <TilesPanel />
    </div>
  );
}
