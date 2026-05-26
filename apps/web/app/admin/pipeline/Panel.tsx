'use client';

import { useMemo, useState } from 'react';
import { Phase1 } from './Phase1';
import { Phase2 } from './Phase2';

export interface PipelineProject {
  id: string;
  slug: string;
  name: string;
  centerLat: number;
  centerLng: number;
  cameraPitch: number;
  cameraYaw: number;
  tileWorldMeters: number;
  tilePixelSize: number;
}

export interface RenderedTileInfo {
  col: number;
  row: number;
  storageKey: string;
  url: string; // /api/storage/<key> served image URL
}

export interface StrategyDescriptor {
  name: string;
  description: string;
}

export interface StrategyRunResult {
  ok: true;
  tiles: Array<{ col: number; row: number; url: string; metadata: Record<string, unknown> }>;
  stitchedUrl: string;
  seamOverlayUrl: string;
}

export interface StrategyRunError {
  ok: false;
  error: string;
}

export interface PipelinePanelProps {
  apiKey: string;
  projects: PipelineProject[];
  strategies: StrategyDescriptor[];
  availableModels: string[];
  defaultPrompt: string;
  /**
   * Accepts a FormData with `projectId`, `col`, `row`, and `png` (Blob) fields.
   * Using FormData avoids the React Flight "maximum array nesting" limit that
   * fires when you pass megabyte-sized base64 data-URLs as plain-string args.
   */
  saveRenderedAction: (
    fd: FormData,
  ) => Promise<{ ok: true; url: string; storageKey: string } | { ok: false; error: string }>;
  listRenderedAction: (projectId: string) => Promise<RenderedTileInfo[]>;
  /** Stitches the currently-saved rendered tiles (no model). Used to verify that rendered geometry lines up without blaming the generator. */
  stitchRenderedAction: (
    projectId: string,
  ) => Promise<{ ok: true; stitchedUrl: string } | { ok: false; error: string }>;
  runStrategyAction: (
    projectId: string,
    strategyName: string,
    modelName: string,
    prompt: string,
  ) => Promise<StrategyRunResult | StrategyRunError>;
}

export function PipelinePanel({
  apiKey,
  projects,
  strategies,
  availableModels,
  defaultPrompt,
  saveRenderedAction,
  listRenderedAction,
  runStrategyAction,
  stitchRenderedAction,
}: PipelinePanelProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const project = useMemo(() => projects.find((p) => p.id === projectId), [projectId, projects]);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="m-0 mb-3 text-[11px] uppercase tracking-wider opacity-[0.55]">project</h2>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded border border-neutral-300 px-2 py-1.5 text-[13px]"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.slug}
            </option>
          ))}
        </select>
        {project && (
          <div className="mt-2 font-mono text-xs opacity-70">
            center {project.centerLat.toFixed(4)}, {project.centerLng.toFixed(4)} · pitch{' '}
            {project.cameraPitch}° · yaw {project.cameraYaw}° · tile {project.tileWorldMeters}m /{' '}
            {project.tilePixelSize}px
          </div>
        )}
      </section>

      {project && (
        <>
          <Phase1
            apiKey={apiKey}
            project={project}
            saveRenderedAction={saveRenderedAction}
            listRenderedAction={listRenderedAction}
            stitchRenderedAction={stitchRenderedAction}
          />
          <Phase2
            project={project}
            strategies={strategies}
            availableModels={availableModels}
            defaultPrompt={defaultPrompt}
            listRenderedAction={listRenderedAction}
            runStrategyAction={runStrategyAction}
          />
        </>
      )}
    </div>
  );
}
