import path from 'path';
import { fileURLToPath } from 'url';

import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

const webDir = path.dirname(fileURLToPath(import.meta.url));
// Merge repo-root `.env` so Supabase/Drive keys don't need duplicating into web/.env.local
loadEnvConfig(path.join(webDir, '..'));

const nextConfig: NextConfig = {
  serverExternalPackages: ['googleapis'],
};

export default nextConfig;
