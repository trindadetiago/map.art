import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser } from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface RenderPayload {
  apiKey: string;
  center: { lat: number; lng: number };
  pitch: number;
  yaw: number;
  size: number;
  zoom: number;
}

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--use-gl=swiftshader',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }
  return browser;
}

export async function renderTile(payload: RenderPayload): Promise<Buffer> {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setViewport({
      width: payload.size,
      height: payload.size,
      deviceScaleFactor: 1,
    });

    const html = readFileSync(join(__dirname, 'render-page.html'), 'utf-8');
    await page.setContent(html);

    await page.evaluate((p: RenderPayload) => {
      (window as unknown as Record<string, unknown>).__RENDER_PARAMS__ = p;
    }, payload);

    await page.waitForFunction('window.__TILES_READY__ === true', { timeout: 120000 });

    const dataUrl = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('No canvas found');
      return canvas.toDataURL('image/png');
    });

    const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
    const b64 = match?.[1];
    if (!b64) throw new Error('Invalid data URL');
    return Buffer.from(b64, 'base64');
  } finally {
    await page.close();
  }
}

export async function dispose() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
