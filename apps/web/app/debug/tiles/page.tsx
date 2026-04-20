import { TilesPanel } from '@mapart/tiles/debug';

export default function TilesDebugPage() {
  return (
    <div>
      <h1 style={{ marginTop: 0 }}>tiles</h1>
      <p style={{ opacity: 0.7, maxWidth: 640 }}>
        Web-mercator tile math. Pick a bbox or circle + zoom; the SVG overlay shows every tile that
        would be seeded into a project's grid at that zoom.
      </p>
      <TilesPanel />
    </div>
  );
}
