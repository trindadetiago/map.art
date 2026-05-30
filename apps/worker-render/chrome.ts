import puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';

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
