import { describe, expect, it } from 'vitest';
import { vizDziKey, vizMetadataKey, vizThumbKey, vizTilesPrefix } from '../src/keys';
import type { VizMetadata } from '../src/types';

const ID = '11111111-2222-3333-4444-555555555555';
const meta = (
  version?: string,
): Pick<VizMetadata, 'width' | 'height' | 'tileSize' | 'format' | 'version'> => ({
  width: 50176,
  height: 39936,
  tileSize: 512,
  format: 'webp',
  ...(version ? { version } : {}),
});

describe('pyramid key layout', () => {
  it('addresses tiles under the version that produced them', () => {
    expect(vizTilesPrefix(ID, 'abc123')).toBe(`viz/${ID}/v/abc123/tiles_files`);
    expect(vizDziKey(ID, 'abc123')).toBe(`viz/${ID}/v/abc123/tiles.dzi`);
  });

  it('falls back to the flat layout for pyramids exported before versioning', () => {
    expect(vizTilesPrefix(ID)).toBe(`viz/${ID}/tiles_files`);
    expect(vizDziKey(ID)).toBe(`viz/${ID}/tiles.dzi`);
  });

  it('keeps the descriptor at a fixed key — it is the pointer, so it cannot move', () => {
    expect(vizMetadataKey(ID)).toBe(`viz/${ID}/metadata.json`);
  });

  it('threads the version through the thumbnail key', () => {
    // The minimap is a plain <img> at this key; missing the version would point
    // it at the previous export's tile, or at nothing once that is pruned.
    expect(vizThumbKey(ID, meta('abc123'))).toBe(`viz/${ID}/v/abc123/tiles_files/9/0_0.webp`);
    expect(vizThumbKey(ID, meta())).toBe(`viz/${ID}/tiles_files/9/0_0.webp`);
  });

  it('gives two exports different tile URLs', () => {
    // The whole point: a rebuild must not reuse an address a browser or CDN
    // already holds bytes for.
    expect(vizTilesPrefix(ID, 'v1')).not.toBe(vizTilesPrefix(ID, 'v2'));
  });
});
