import { Card, Metric } from '@/components/admin/card';
import {
  IconCamera,
  IconDatabase,
  IconEnv,
  IconGrid,
  IconLayers,
  IconMap,
  IconSparkles,
  IconStorage,
  IconWorkflow,
} from '@/components/admin/icons';
import { Section } from '@/components/admin/section';
import { repos } from '@mapart/db';
import { env, getEnvStatus } from '@mapart/env';
import { getStorage } from '@mapart/storage';

export const dynamic = 'force-dynamic';

interface Stats {
  projects: number;
  recentProjects: { id: string; slug: string; name: string }[];
  tiles: number;
  tileVersions: number;
  jobs: number;
  models: number;
  pgVersion: string | null;
  postgisInstalled: boolean;
  storageFiles: number;
  storageBytes: number;
  envSet: number;
  envDefault: number;
  envUnset: number;
}

async function loadStats(): Promise<Stats> {
  const fallback: Stats = {
    projects: 0,
    recentProjects: [],
    tiles: 0,
    tileVersions: 0,
    jobs: 0,
    models: 0,
    pgVersion: null,
    postgisInstalled: false,
    storageFiles: 0,
    storageBytes: 0,
    envSet: 0,
    envDefault: 0,
    envUnset: 0,
  };

  const envStatus = getEnvStatus();
  fallback.envSet = envStatus.filter((e) => e.isSet && !e.usingDefault).length;
  fallback.envDefault = envStatus.filter((e) => e.usingDefault).length;
  fallback.envUnset = envStatus.filter((e) => !e.isSet).length;

  try {
    const [projectsList, counts, pg] = await Promise.all([
      repos.listProjects(),
      repos.getTableCounts(),
      repos.getPostgresInfo(),
    ]);
    fallback.projects = counts.projects;
    fallback.tiles = counts.tiles;
    fallback.tileVersions = counts.tileVersions;
    fallback.jobs = counts.jobs;
    fallback.models = counts.models;
    fallback.recentProjects = projectsList.slice(0, 3).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
    }));
    fallback.pgVersion = shortPgVersion(pg.version);
    fallback.postgisInstalled = pg.postgisVersion !== null;
  } catch {
    // DB not running — keep zeros, don't fail the page.
  }

  try {
    const entries = await getStorage().list('');
    fallback.storageFiles = entries.length;
    fallback.storageBytes = entries.reduce((acc, e) => acc + e.size, 0);
  } catch {
    // Storage not configured — keep zeros.
  }

  return fallback;
}

export default async function AdminIndex() {
  const s = await loadStats();

  return (
    <div>
      <Section label="Projects" description="state of the work">
        <div className="grid grid-cols-4 gap-4">
          <Card
            icon={IconLayers}
            label="Total projects"
            href="/admin/projects"
            className="col-span-2 row-span-2 min-h-[280px]"
          >
            <Metric
              value={s.projects}
              caption={
                s.recentProjects.length > 0
                  ? `Latest: ${s.recentProjects.map((p) => p.slug).join(' · ')}`
                  : 'No projects yet'
              }
            />
          </Card>
          <Card icon={IconGrid} label="Tile rows">
            <Metric value={s.tiles.toLocaleString()} caption="seeded across all projects" />
          </Card>
          <Card icon={IconSparkles} label="Tile versions">
            <Metric value={s.tileVersions.toLocaleString()} caption="rendered + stylized" />
          </Card>
          <Card icon={IconWorkflow} label="Jobs">
            <Metric value={s.jobs.toLocaleString()} caption="render / stylize queue" />
          </Card>
          <Card icon={IconSparkles} label="Models">
            <Metric value={s.models} caption="registered in db" />
          </Card>
        </div>
      </Section>

      <Section label="Infra" description="data + config">
        <div className="grid grid-cols-3 gap-4">
          <Card
            icon={IconDatabase}
            label="Database"
            href="/admin/db"
            badge={s.pgVersion ? 'live' : 'down'}
          >
            <Metric
              value={s.pgVersion ?? '—'}
              caption={s.postgisInstalled ? 'with PostGIS' : 'PostGIS missing'}
            />
          </Card>
          <Card icon={IconStorage} label="Storage" href="/admin/storage" badge={env.storageBackend}>
            <Metric
              value={s.storageFiles.toLocaleString()}
              caption={`${formatBytes(s.storageBytes)} across all blobs`}
            />
          </Card>
          <Card
            icon={IconEnv}
            label="Env"
            href="/admin/env"
            badge={`${s.envSet + s.envDefault}/${s.envSet + s.envDefault + s.envUnset}`}
          >
            <Metric
              value={s.envSet + s.envDefault}
              caption={`${s.envDefault} default · ${s.envUnset} unset`}
            />
          </Card>
        </div>
      </Section>

      <Section label="Packages" description="tooling per module">
        <div className="grid grid-cols-4 gap-4">
          <Card icon={IconMap} label="Tiles" href="/admin/tiles">
            <Caption>Web-mercator tile math. Pick an area, see the tile coverage at z.</Caption>
          </Card>
          <Card icon={IconSparkles} label="Models" href="/admin/models">
            <Caption>Run an input PNG through an image-edit model with a prompt.</Caption>
          </Card>
          <Card icon={IconCamera} label="Renderer" href="/admin/renderer">
            <Caption>Live Three.js scene streaming Google Photorealistic 3D Tiles.</Caption>
          </Card>
          <Card icon={IconWorkflow} label="Pipeline" href="/admin/pipeline" badge="wip">
            <Caption>
              Generation strategies. Phase 1 renders N tiles, Phase 2 stylizes & stitches.
            </Caption>
          </Card>
        </div>
      </Section>
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 mb-0 max-w-[28ch] text-[13px] leading-snug text-stone-500">{children}</p>
  );
}

function shortPgVersion(v: string): string {
  const m = v.match(/PostgreSQL\s+(\d+(?:\.\d+)?)/i);
  return m ? `pg ${m[1]}` : v.split(' ').slice(0, 2).join(' ');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
