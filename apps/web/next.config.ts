import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Локально настройки лежат в корневом .env (как у пакетов); на Vercel и в Docker — в окружении.
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const config: NextConfig = {
  // Один и тот же Next.js запускается на Vercel и в Docker на VPS.
  output: 'standalone',
  outputFileTracingRoot: root,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    '@buhuchet/api',
    '@buhuchet/adapters',
    '@buhuchet/db',
    '@buhuchet/domain',
    '@buhuchet/shared',
    '@buhuchet/ui',
  ],
  serverExternalPackages: [
    'pino',
    'postgres',
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
  ],
};

export default config;
