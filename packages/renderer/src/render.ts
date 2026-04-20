import type { RenderParams } from '@mapart/shared';
import sharp from 'sharp';

export async function renderTile(params: RenderParams): Promise<Buffer> {
  const { size, yaw, pitch, center, zoom } = params;

  const hue = ((yaw % 360) + 360) % 360;
  const { r, g, b } = hslToRgb(hue / 360, 0.55, 0.5);

  const label = `yaw ${yaw.toFixed(0)}° · pitch ${pitch.toFixed(0)}° · z ${zoom.toFixed(1)}\n${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="100%" height="100%" fill="rgb(${r},${g},${b})"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
      font-family="system-ui, -apple-system, sans-serif" font-size="${Math.max(12, size / 28)}"
      fill="white" opacity="0.85">
      <tspan x="50%" dy="-0.6em">${escapeXml(label.split('\n')[0] ?? '')}</tspan>
      <tspan x="50%" dy="1.4em">${escapeXml(label.split('\n')[1] ?? '')}</tspan>
    </text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return {
    r: Math.round(255 * f(0)),
    g: Math.round(255 * f(8)),
    b: Math.round(255 * f(4)),
  };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
