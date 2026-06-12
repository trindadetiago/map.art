import { repos } from '@mapart/db';
import { NextResponse } from 'next/server';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const poll = async () => {
        if (closed) return;
        try {
          const job = await repos.getJob(id);
          if (!job) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: 'not found' })}\n\n`),
            );
            controller.close();
            return;
          }
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                id: job.id,
                status: job.status,
                kind: job.kind,
                col: job.col,
                row: job.row,
                attempts: job.attempts,
                error: job.error,
                progress: job.payload,
              })}\n\n`,
            ),
          );
          if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
            controller.close();
            return;
          }
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`,
            ),
          );
          controller.close();
          return;
        }
        setTimeout(poll, 2000);
      };
      poll();
    },
    cancel() {
      closed = true;
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
