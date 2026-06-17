import { PinsEditor } from '@/components/admin/pins/pins_editor';
import { ProjectPicker } from '@/components/admin/pins/project_picker';
import { Section } from '@/components/admin/section';
import { repos } from '@mapart/db';
import { env } from '@mapart/env';
import { getProjectPins, setProjectPins, validatePins } from '@mapart/export/pins';
import type { VizPin } from '@mapart/export/types';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

/** Where the map opens when a project has no tiles to centre on (central JP). */
const FALLBACK_CENTER = { lat: -7.115, lng: -34.861 };

async function savePinsAction(
  projectId: string,
  pins: VizPin[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  'use server';
  try {
    const clean = validatePins(pins);
    await setProjectPins(projectId, clean);
    revalidatePath('/admin/pins');
    return { ok: true, count: clean.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function PinsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = sp.project;
  const projectId = Array.isArray(raw) ? raw[0] : raw;

  let projects: { id: string; name: string }[] = [];
  let dbDown = false;
  try {
    projects = (await repos.listProjects()).map((p) => ({ id: p.id, name: p.name }));
  } catch {
    dbDown = true;
  }

  const active = projectId ? projects.find((p) => p.id === projectId) : undefined;

  let initialPins: VizPin[] = [];
  let center = FALLBACK_CENTER;
  if (active) {
    initialPins = await getProjectPins(active.id);
    center = (await repos.projectCenter(active.id)) ?? FALLBACK_CENTER;
  }

  return (
    <div>
      <div className="mb-10 flex items-baseline gap-4">
        <h1 className="m-0 text-3xl font-light tracking-tight text-stone-900">Project pins</h1>
        <span className="text-sm text-stone-500">
          lat/lng markers overlaid on the visualizer map
        </span>
      </div>

      <Section label="Project" description="pick which project's pins to edit">
        <div className="max-w-sm rounded-2xl border border-stone-200/70 bg-white p-6">
          {dbDown ? (
            <p className="m-0 text-sm text-stone-500">
              Database is unreachable. Start the dev stack with <code>pnpm dev</code>.
            </p>
          ) : (
            <ProjectPicker projects={projects} selected={active?.id ?? null} />
          )}
        </div>
      </Section>

      {active ? (
        <Section
          label={`Pins · ${active.name}`}
          description="click the map to drop a pin · drag a marker to move it"
        >
          <PinsEditor
            projectId={active.id}
            apiKey={env.googleMapsApiKey ?? ''}
            center={center}
            initialPins={initialPins}
            saveAction={savePinsAction}
          />
        </Section>
      ) : (
        !dbDown && (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white/40 p-12 text-center">
            <div className="text-[15px] font-medium text-stone-700">No project selected</div>
            <p className="mx-auto mt-2 mb-0 max-w-[44ch] text-sm text-stone-500">
              Choose a project above to view and edit its map pins.
            </p>
          </div>
        )
      )}
    </div>
  );
}
