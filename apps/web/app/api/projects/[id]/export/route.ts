import { repos } from '@mapart/db';
import { type NextRequest, NextResponse } from 'next/server';
import { log } from '../../../../../lib/logger';
import {
  RailwayError,
  exportTriggerConfigured,
  wakeExportRunner,
} from '../../../../../lib/railway';

export const dynamic = 'force-dynamic';

/** A run older than this with no completion is treated as dead, not in-flight. */
const STALE_AFTER_MS = 40 * 60 * 1000;

function isActive(e: { status: string; createdAt: Date }): boolean {
  if (e.status !== 'queued' && e.status !== 'running') return false;
  return Date.now() - e.createdAt.getTime() < STALE_AFTER_MS;
}

/** Latest run for the project, so the admin can show progress across reloads. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const latest = await repos.latestExport(id);
    return NextResponse.json({
      ok: true,
      configured: exportTriggerConfigured(),
      export: latest
        ? {
            id: latest.id,
            status: latest.status,
            source: latest.source,
            error: latest.error,
            placed: latest.placed,
            uploaded: latest.uploaded,
            createdAt: latest.createdAt,
            finishedAt: latest.finishedAt,
            stale: !isActive(latest) && (latest.status === 'queued' || latest.status === 'running'),
          }
        : null,
    });
  } catch (e) {
    log.error('export status failed', { projectId: id, err: e });
    return NextResponse.json({ ok: false, error: 'could not read export status' }, { status: 500 });
  }
}

/** Queue an export and hand it to the runner. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const source = req.nextUrl.searchParams.get('source') ?? 'stylized';
  if (source !== 'stylized' && source !== 'rendered') {
    return NextResponse.json(
      { ok: false, error: 'source must be stylized or rendered' },
      { status: 400 },
    );
  }
  if (!exportTriggerConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'exports are not configured — RAILWAY_API_TOKEN is unset' },
      { status: 503 },
    );
  }

  try {
    const project = await repos.getProjectById(id);
    if (!project)
      return NextResponse.json({ ok: false, error: 'project not found' }, { status: 404 });

    // One run at a time per project: two concurrent exports write the same
    // pyramid keys and would interleave into a corrupt mix of both.
    const latest = await repos.latestExport(id);
    if (latest && isActive(latest)) {
      return NextResponse.json(
        { ok: false, error: 'an export is already running for this project' },
        { status: 409 },
      );
    }

    const row = await repos.createExport(id, source);
    try {
      await wakeExportRunner();
    } catch (e) {
      // The row is queued but nothing was woken to claim it — close it out
      // rather than leaving a run that polls as "queued" forever.
      await repos.markExportError(row.id, e instanceof Error ? e.message : String(e));
      throw e;
    }
    log.info('export queued', { projectId: id, exportId: row.id, source });
    return NextResponse.json({ ok: true, exportId: row.id });
  } catch (e) {
    const msg = e instanceof RailwayError ? e.message : 'could not start the export';
    log.error('export trigger failed', { projectId: id, err: e });
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
