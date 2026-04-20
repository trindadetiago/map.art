import '@mapart/env';
import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: [
    '@mapart/env',
    '@mapart/shared',
    '@mapart/renderer',
    '@mapart/models',
    '@mapart/storage',
    '@mapart/tiles',
    '@mapart/db',
    '3d-tiles-renderer',
    'three',
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default config;
