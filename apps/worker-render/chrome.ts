// puppeteer is installed under the npm alias "pptr": Railpack scans every
// workspace package.json for a dependency literally named "puppeteer" and,
// when found, bakes Chrome's ~40 apt packages into every service's image —
// not just this one. The alias keeps that detection from firing; this
// service declares the libraries it needs via RAILPACK_DEPLOY_APT_PACKAGES.
import puppeteer from 'pptr';
import type { Browser } from 'pptr';

export const VIEWPORT_PAD = 100;

/** ANGLE GPU backend for the current platform: Metal on macOS, EGL on Linux. */
function angleBackend(): string {
  switch (process.platform) {
    case 'darwin':
      return 'metal';
    case 'linux':
      return 'gl-egl';
    default:
      return 'gl';
  }
}

function chromeArgs(): string[] {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-gl=angle',
    `--use-angle=${angleBackend()}`,
    '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage',
  ];
}

export async function launchBrowser(): Promise<Browser> {
  const args = chromeArgs();
  console.log(`[chrome] launching — angle=${angleBackend()} args=${args.join(' ')}`);
  return puppeteer.launch({ headless: true, args });
}
