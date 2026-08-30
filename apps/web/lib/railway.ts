import { env } from '@mapart/env';

/**
 * Just enough of Railway's API to run an export.
 *
 * Exports are too heavy for this process — a project is a couple of gigapixels
 * stitched through libvips — so they run on a separate `export-runner` service
 * that is idle between runs. Starting one means pointing the runner at a project
 * and redeploying it: it runs the export once and exits.
 */

const API = 'https://backboard.railway.com/graphql/v2';

export class RailwayError extends Error {}

/** Whether the admin can trigger exports at all — the token is what gates it. */
export function exportTriggerConfigured(): boolean {
  return !!env.railwayApiToken && !!env.railwayProjectId && !!env.railwayEnvironmentId;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.railwayApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new RailwayError(body.errors[0]?.message ?? 'Railway API error');
  if (!res.ok) throw new RailwayError(`Railway API ${res.status}`);
  if (!body.data) throw new RailwayError('Railway API returned no data');
  return body.data;
}

interface ServiceEdge {
  node: { id: string; name: string };
}

async function findRunnerServiceId(): Promise<string> {
  const data = await gql<{ project: { services: { edges: ServiceEdge[] } } }>(
    'query($id: String!) { project(id: $id) { services { edges { node { id name } } } } }',
    { id: env.railwayProjectId },
  );
  const svc = data.project.services.edges.find((e) => e.node.name === env.exportRunnerService);
  if (!svc) {
    throw new RailwayError(
      `no "${env.exportRunnerService}" service in this Railway project — create it once with scripts/export-on-railway.mjs`,
    );
  }
  return svc.node.id;
}

/**
 * Wake the runner so it picks up whatever is queued.
 *
 * Nothing about *which* export to run is passed here — the queued row is the
 * instruction, and the runner claims it on start. That way a restart for any
 * other reason (a CI deploy, a crash, a platform migration) finds an empty
 * queue and exits, instead of replaying the last export it was told about.
 */
export async function wakeExportRunner(): Promise<void> {
  const serviceId = await findRunnerServiceId();
  await gql(
    `mutation($serviceId: String!, $environmentId: String!) {
       serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
     }`,
    { serviceId, environmentId: env.railwayEnvironmentId },
  );
}
