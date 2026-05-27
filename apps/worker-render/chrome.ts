import { env } from '@mapart/env';
import puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';

export const VIEWPORT_PAD = 100;

export type RenderGpuMode = 'cpu' | 'gpu';

function resolveGpuMode(): RenderGpuMode {
  if (env.renderGpuEnabled) return 'gpu';
  return 'cpu';
}

function angleBackend(mode: RenderGpuMode): string {
  if (mode === 'gpu') {
    switch (process.platform) {
      case 'darwin':
        return 'metal';
      case 'linux':
        return 'gl-egl';
      default:
        return 'gl';
    }
  }
  return 'swiftshader';
}

export function getChromeArgs(mode?: RenderGpuMode): string[] {
  const gpuMode = mode ?? resolveGpuMode();
  const angle = angleBackend(gpuMode);

  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-gl=angle',
    `--use-angle=${angle}`,
    '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage',
  ];
}

export function getLaunchOptions(mode?: RenderGpuMode) {
  const gpuMode = mode ?? resolveGpuMode();
  return {
    headless: true,
    args: getChromeArgs(gpuMode),
  } satisfies Parameters<typeof puppeteer.launch>[0];
}

export async function launchBrowser(mode?: RenderGpuMode): Promise<Browser> {
  const opts = getLaunchOptions(mode);
  const gpuMode = mode ?? resolveGpuMode();
  console.log(`[chrome] launching — mode=${gpuMode} args=${opts.args?.join(' ')}`);
  return await puppeteer.launch(opts);
}
