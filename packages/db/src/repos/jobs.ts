import { and, eq, sql } from 'drizzle-orm';
import { getDb, getSql } from '../client';
import { jobs } from '../schema/jobs';
import type { Job, NewJob } from '../schema/jobs';

export type { Job, NewJob };

export async function createJob(input: NewJob): Promise<Job> {
  const sqlTx = getSql();
  const rows = await sqlTx<Job[]>`
    INSERT INTO jobs (
      project_id, kind, col, row, model_id, payload, status,
      priority, depends_on, scheduled_at,
      idempotency_key, created_at, updated_at
    )
    VALUES (
      ${input.projectId}::uuid, ${input.kind},
      ${input.col}, ${input.row},
      ${input.modelId ?? null},
      ${JSON.stringify(input.payload ?? {})}::jsonb,
      ${input.status ?? 'pending'},
      ${input.priority ?? 100},
      ${input.dependsOn?.length ? input.dependsOn : []},
      ${input.scheduledAt ?? null},
      ${input.idempotencyKey ?? null},
      now(), now()
    )
    RETURNING *
  `;
  const row = rows[0];
  if (!row) throw new Error('createJob: insert returned no row');
  return row;
}

export async function getJob(id: string): Promise<Job | undefined> {
  const rows = await getDb().select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return rows[0];
}

export async function claimJob(id: string, workerName: string): Promise<Job | undefined> {
  const sqlTx = getSql();
  const rows = await sqlTx<Job[]>`
    UPDATE jobs
    SET status = 'claimed', claimed_by = ${workerName},
        claimed_at = now(), updated_at = now(),
        attempts = attempts + 1
    WHERE id = ${id}::uuid
      AND status = 'pending'
      AND attempts < max_attempts
    RETURNING *
  `;
  return rows[0];
}

export async function claimNextJob(kind: string, workerId: string): Promise<Job | null> {
  const sqlTx = getSql();
  const result = await sqlTx<Job[]>`
    WITH next_job AS (
      SELECT id FROM jobs
      WHERE status = 'pending' AND kind = ${kind}
        AND (scheduled_at IS NULL OR scheduled_at <= now())
      ORDER BY priority ASC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE jobs
    SET status = 'claimed', claimed_by = ${workerId},
        claimed_at = now(), started_at = now()
    FROM next_job
    WHERE jobs.id = next_job.id
    RETURNING jobs.*
  `;
  return result[0] ?? null;
}

export async function completeJob(
  id: string,
  resultVersionId: string | null,
  progress?: Record<string, unknown>,
): Promise<void> {
  const sqlTx = getSql();
  await sqlTx`
    UPDATE jobs
    SET status = 'done',
        result_version_id = ${resultVersionId}::uuid,
        payload = COALESCE(payload, '{}'::jsonb) || ${JSON.stringify(progress ?? {})}::jsonb,
        updated_at = now()
    WHERE id = ${id}::uuid
  `;
}

export async function failJob(id: string, error: string): Promise<void> {
  const sqlTx = getSql();
  await sqlTx`
    UPDATE jobs
    SET status = 'failed',
        error = ${error},
        updated_at = now()
    WHERE id = ${id}::uuid
  `;
}

export async function listJobsForProject(
  projectId: string,
  opts?: { status?: string; limit?: number },
): Promise<Job[]> {
  return getDb()
    .select()
    .from(jobs)
    .where(
      opts?.status
        ? and(eq(jobs.projectId, projectId), eq(jobs.status, opts.status as Job['status']))
        : eq(jobs.projectId, projectId),
    )
    .orderBy(sql`created_at DESC`)
    .limit(opts?.limit ?? 100);
}
