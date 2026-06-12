import { repos } from '@mapart/db';
import { NextResponse } from 'next/server';

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const summary = await repos.getTileStatusSummary(projectId);

  return NextResponse.json(summary);
}
