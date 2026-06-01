#!/usr/bin/env node
// Runs an ngrok tunnel to local MinIO (:9000) and writes the public URL to
// <repo>/.ngrok-url so worker-stylize can hand oxen.ai a publicly-fetchable
// URL for each composite. oxen rejects data URIs, and its servers can't reach
// localhost — the tunnel bridges that for local testing.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, '.ngrok-url');
const PORT = process.env.MINIO_PORT || '9000';
const API = 'http://127.0.0.1:4040/api/tunnels';

const ngrok = spawn('ngrok', ['http', PORT, '--log', 'stdout'], {
  stdio: ['ignore', 'inherit', 'inherit'],
});
ngrok.on('exit', (code) => process.exit(code ?? 0));

let last = '';
async function poll() {
  try {
    const res = await fetch(API);
    if (res.ok) {
      const data = await res.json();
      const tunnel = data.tunnels?.find((t) => t.proto === 'https') ?? data.tunnels?.[0];
      const url = tunnel?.public_url;
      if (url && url !== last) {
        writeFileSync(OUT, `${url}\n`);
        last = url;
        console.log(`[ngrok] public url -> ${url} (written to .ngrok-url)`);
      }
    }
  } catch {
    // ngrok API not up yet — keep polling
  }
  setTimeout(poll, 2000);
}
poll();

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    ngrok.kill('SIGTERM');
    process.exit(0);
  });
}
