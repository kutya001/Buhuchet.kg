import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Локально настройки лежат в корневом .env (как у пакетов); на Vercel и в Docker — в окружении.
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

// Заголовки безопасности страниц (у /api свои — secureHeaders в @buhuchet/api). Одинаковы на Vercel и VPS.
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'microphone=(), geolocation=()' },
];

const config: NextConfig = {
  // Один и тот же Next.js запускается на Vercel и в Docker на VPS.
  output: 'standalone',
  outputFileTracingRoot: root,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/((?!api/).*)', headers: SECURITY_HEADERS }];
  },
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
