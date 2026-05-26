#!/usr/bin/env node
// Spawns a command, streams its stdout+stderr to BOTH this process's
// stdio (so the mprocs pane sees it live) AND .logs/<name>.log
// (truncated on every run, so the file always reflects the current session).
// Usage: node scripts/run.mjs <name> -- <command> [args...]
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const dashDash = args.indexOf('--');
if (args.length < 1 || dashDash < 1 || dashDash === args.length - 1) {
  console.error('Usage: node scripts/run.mjs <name> -- <command> [args...]');
  process.exit(2);
}
const name = args[0];
const cmd = args.slice(dashDash + 1);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logsDir = resolve(root, '.logs');
mkdirSync(logsDir, { recursive: true });
const logStream = createWriteStream(resolve(logsDir, `${name}.log`), { flags: 'w' });

const child = spawn(cmd[0], cmd.slice(1), {
  cwd: root,
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: false,
});

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  logStream.write(chunk);
});
child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  logStream.write(chunk);
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => child.kill(sig));
}

child.on('exit', (code, signal) => {
  logStream.end();
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error(`[run.mjs] failed to spawn '${cmd[0]}':`, err.message);
  process.exit(1);
});
