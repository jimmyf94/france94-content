import path from 'path';
import { fileURLToPath } from 'url';

import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

const webDir = path.dirname(fileURLToPath(import.meta.url));
// Merge repo-root `.env` — single env file for local dev and Vercel (set env vars in dashboard)
loadEnvConfig(path.join(webDir, '..'));

const repoRoot = path.join(webDir, '..');

const nextConfig: NextConfig = {
  // Allow file tracing to reach repo-root `scripts/prompts/` (outside `web/`).
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    'app/api/content-review/**': ['../scripts/prompts/**/*.txt'],
  },
  serverExternalPackages: ['googleapis', 'undici'],
  // Shared `scripts/lib/ai` uses NodeNext-style `.js` import specifiers; map them to `.ts` sources.
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
