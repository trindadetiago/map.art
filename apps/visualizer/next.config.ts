import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '@mapart/env';
import type { NextConfig } from 'next';

// Auto-discover @mapart/* workspace packages so adding a new package doesn't
// require remembering to edit this config. Anything that's a directory under
// packages/ gets included.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mapartPackages = readdirSync(join(repoRoot, 'packages'))
  .filter((name) => !name.startsWith('.'))
  .filter((name) => statSync(join(repoRoot, 'packages', name)).isDirectory())
  .map((name) => `@mapart/${name}`);

const config: NextConfig = {
  // `three` (via @mapart/ui globe) ships untranspiled ESM under three/examples/jsm.
  transpilePackages: [...mapartPackages, 'three'],
  // Proxy PostHog through our own origin: @mapart/ui/analytics points posthog-js at
  // /ingest, and content blockers match on the posthog.com hostname it never sees.
  // Ingestion paths end in a slash, so the redirect skip is what keeps them intact.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      { source: '/ingest/:path*', destination: 'https://us.i.posthog.com/:path*' },
    ];
  },
};

export default config;
