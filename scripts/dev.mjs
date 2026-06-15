#!/usr/bin/env node
// Launches the dev TUI (mprocs) with a generated proc layout.
//
// Accepts an optional `s<N>` argument to run N stylize workers (1..10) as their
// own panes. Multiple stylize workers coordinate through the queue (each claims
// tiles with FOR UPDATE SKIP LOCKED), so they parallelise without colliding.
//
//   pnpm dev          # 1 stylize worker
//   pnpm dev s5       # 5 stylize workers (also accepted: s=5, s 5)
//
// The mprocs config is generated here rather than kept in a static mprocs.yaml,
// so the worker count can vary per run. run.mjs forces each command's cwd to the
// repo root, so an absolute runner path is all that's needed for cwd-safety.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptsDir, '..');
const runner = resolve(scriptsDir, 'run.mjs');
const ngrokScript = resolve(scriptsDir, 'ngrok.mjs');

// --- parse the stylize-worker count from args -----------------------------
const args = process.argv.slice(2);
let stylize = 1;
for (let i = 0; i < args.length; i++) {
  const inline = /^s=?(\d+)$/.exec(args[i]);
  if (inline) {
    stylize = Number(inline[1]);
  } else if (args[i] === 's' && /^\d+$/.test(args[i + 1] ?? '')) {
    stylize = Number(args[++i]);
  }
}
if (!Number.isInteger(stylize) || stylize < 1 || stylize > 10) {
  console.error(`stylize worker count must be between 1 and 10 (got "${stylize}").`);
  console.error('Usage: pnpm dev [s<N>]   e.g. pnpm dev s5');
  process.exit(2);
}

// --- build the proc layout ------------------------------------------------
const run = (name, cmd) => ({ shell: `node ${JSON.stringify(runner)} ${name} -- ${cmd}` });
const stylizeCmd = 'pnpm --filter @mapart/worker-stylize dev';

const procs = {
  web: run('web', 'pnpm --filter @mapart/web dev'),
  visualizer: run('visualizer', 'pnpm --filter @mapart/visualizer dev'),
  'worker-render': run('worker-render', 'pnpm --filter @mapart/worker-render dev'),
};
if (stylize === 1) {
  procs['worker-stylize'] = run('worker-stylize', stylizeCmd);
} else {
  for (let i = 1; i <= stylize; i++) {
    procs[`worker-stylize-${i}`] = run(`worker-stylize-${i}`, stylizeCmd);
  }
}
procs.ngrok = run('ngrok', `node ${JSON.stringify(ngrokScript)}`);
procs['drizzle-studio'] = run('drizzle-studio', 'pnpm --filter @mapart/db drizzle studio');

// --- write a temp mprocs config and launch --------------------------------
// JSON.stringify produces valid YAML double-quoted scalars, so quoting the key
// and shell value this way yields unambiguously-valid YAML for any contents.
const lines = ['procs:'];
for (const [name, def] of Object.entries(procs)) {
  lines.push(`  ${JSON.stringify(name)}:`);
  lines.push(`    shell: ${JSON.stringify(def.shell)}`);
}
const dir = mkdtempSync(join(tmpdir(), 'mapart-dev-'));
const configPath = join(dir, 'mprocs.yaml');
writeFileSync(configPath, `${lines.join('\n')}\n`);

const localMprocs = resolve(root, 'node_modules', '.bin', 'mprocs');
const mprocsBin = existsSync(localMprocs) ? localMprocs : 'mprocs';

if (stylize > 1) console.log(`[dev] starting ${stylize} stylize workers`);
const res = spawnSync(mprocsBin, ['--config', configPath], { stdio: 'inherit', cwd: root });
process.exit(res.status ?? (res.signal ? 1 : 0));
