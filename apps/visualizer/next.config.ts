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
  transpilePackages: mapartPackages,
};

export default config;
