#!/usr/bin/env node
// Build a project's deep-zoom pyramid *inside* Railway, where the database is
// reachable on the private network and t3 storage is local-fast.
//
//   node scripts/export-on-railway.mjs <projectId> [stylized|rendered]
//
// Why this exists: `exportProjectDzi` reads a project's tiles from the DB and
// streams thousands of objects to/from S3. Run from a laptop it stalls — t3
// throttles/cancels requests over the public internet, and the prod DB is only
// on `*.railway.internal`. So we run the export on a small, reusable Railway
// service (`export-runner`) instead.
//
// The runner is normally idle: the export command runs once and exits, Railway
// tears the container down, and nothing is billed until the next run. Re-running
// just redeploys it with a new EXPORT_PROJECT_ID — no per-run service churn.
//
// Prereqs: `railway login` + `railway link` (project "azimute art project",
// production). The `web` service must hold the S3_* vars and a `Postgres`
// service must exist — the runner references both.
import { spawnSync } from 'node:child_process';

const SERVICE = 'export-runner';
const POLL_MS = 8000;
const TIMEOUT_MS = 20 * 60 * 1000;

const projectId = process.argv[2];
const source = process.argv[3] ?? 'stylized';
if (!projectId || (source !== 'stylized' && source !== 'rendered')) {
  console.error('usage: node scripts/export-on-railway.mjs <projectId> [stylized|rendered]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function railway(args, opts = {}) {
  return spawnSync('railway', args, { encoding: 'utf8', ...opts });
}

// The runner's full config. References (${{...}}) resolve at deploy time, so no
// secrets pass through this script. The start command always exits 0 (echoes
// the real code) so a failed export doesn't trigger Railway's restart policy.
const variables = [
  'RAILPACK_INSTALL_CMD=pnpm install --frozen-lockfile',
  // No build step — the CLI runs straight from TS via tsx. `true` no-ops the
  // build phase so Railpack doesn't run the root `build` script (which would
  // `next build` every app).
  'RAILPACK_BUILD_CMD=true',
  'RAILPACK_START_CMD=pnpm mapart export dzi --project $EXPORT_PROJECT_ID --source $EXPORT_SOURCE; echo EXPORT_DONE_EXIT=$?',
  'PUPPETEER_SKIP_DOWNLOAD=true', // the runner never needs Chromium
  'DATABASE_URL=${{Postgres.DATABASE_URL}}', // private network — no public proxy
  'S3_ENDPOINT=${{web.S3_ENDPOINT}}',
  'S3_REGION=${{web.S3_REGION}}',
  'S3_ACCESS_KEY_ID=${{web.S3_ACCESS_KEY_ID}}',
  'S3_SECRET_ACCESS_KEY=${{web.S3_SECRET_ACCESS_KEY}}',
  'S3_BUCKET=${{web.S3_BUCKET}}',
  `EXPORT_PROJECT_ID=${projectId}`,
  `EXPORT_SOURCE=${source}`,
];

function serviceExists() {
  const res = railway(['status', '--json']);
  if (res.status !== 0) return false;
  try {
    const data = JSON.parse(res.stdout);
    for (const env of data.environments?.edges ?? []) {
      for (const si of env.node?.serviceInstances?.edges ?? []) {
        if (si.node?.serviceName === SERVICE) return true;
      }
    }
  } catch {
    /* fall through */
  }
  return false;
}

function configure() {
  if (serviceExists()) {
    console.log(`[runner] updating ${SERVICE} variables`);
    const args = ['variables', '--service', SERVICE];
    for (const v of variables) args.push('--set', v);
    return railway(args, { stdio: 'inherit' });
  }
  console.log(`[runner] creating ${SERVICE}`);
  const args = ['add', '--service', SERVICE];
  for (const v of variables) args.push('--variables', v);
  return railway(args, { stdio: 'inherit' });
}

// Poll a SPECIFIC deployment's logs. Scoping to the deployment id matters:
// `railway logs` without one falls back to the previous deployment, so a fresh
// run would otherwise read a prior failed run's logs and report a false verdict.
async function pollUntilDone(deploymentId) {
  const deadline = Date.now() + TIMEOUT_MS;
  const seen = new Set();
  console.log('[runner] building + running (first build is a few minutes)…');
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const res = railway(['logs', deploymentId, '-d', '--lines', '150']);
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    for (const line of out.split('\n')) {
      const t = line.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      if (/stitching|pyramid uploaded|EXPORT_DONE_EXIT|error|Error|exception/i.test(t)) {
        console.log(`  ${t}`);
      }
    }
    if (/pyramid uploaded|EXPORT_DONE_EXIT=0\b/.test(out)) return 'ok';
    const fail = out.match(/EXPORT_DONE_EXIT=([1-9]\d*)/);
    if (fail) return `export failed (exit ${fail[1]})`;
  }
  return 'timed out waiting for the export';
}

async function main() {
  const cfg = configure();
  if (cfg.status !== 0) {
    console.error('[runner] failed to configure the service');
    process.exit(1);
  }

  console.log(`[runner] deploying export of ${projectId} (${source})`);
  const up = railway(['up', '--service', SERVICE, '--detach']);
  process.stdout.write(up.stdout ?? '');
  if (up.status !== 0) {
    console.error(up.stderr ?? '');
    console.error('[runner] `railway up` failed');
    process.exit(1);
  }

  // `railway up` prints a build-logs URL containing the new deployment id.
  const deploymentId = `${up.stdout ?? ''}`.match(/[?&]id=([0-9a-f-]{36})/)?.[1];
  if (!deploymentId) {
    console.error('[runner] could not determine the new deployment id from `railway up` output');
    process.exit(1);
  }

  const verdict = await pollUntilDone(deploymentId);
  if (verdict === 'ok') {
    console.log(`\n✅ export complete — pyramid is in storage for project ${projectId}`);
    process.exit(0);
  }
  console.error(`\n❌ ${verdict}. Inspect: railway logs --service ${SERVICE} -d`);
  process.exit(1);
}

await main();
