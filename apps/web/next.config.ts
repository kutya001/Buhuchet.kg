import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PNPM = '../../node_modules/.pnpm';

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
    // «Из свидетельства и выписки» (задача 2.17): чтение PDF и распознавание сканов на сервере.
    'pdfjs-dist',
    'tesseract.js',
    '@tesseract.js-data/rus',
    '@tesseract.js-data/kir',
  ],
  // Распознаватель сканов запускает свой поток из файла и загружает wasm и языковые данные по пути —
  // сборка их сама не находит, а образ web содержит только найденное. Ключ — путь маршрута API
  // (квадратные скобки экранированы: ключ — шаблон). Ядро — без вариантов «.wasm.js» для браузера.
  outputFileTracingIncludes: {
    '/api/\\[\\[...route\\]\\]': [
      `${PNPM}/tesseract.js@*/node_modules/tesseract.js/{package.json,src/**/*}`,
      `${PNPM}/tesseract.js@*/node_modules/{bmp-js,is-url,regenerator-runtime,wasm-feature-detect}/**/*`,
      `${PNPM}/tesseract.js@*/node_modules/tesseract.js-core/{package.json,index.js,tesseract-core{,-simd,-relaxedsimd}{,-lstm}.{js,wasm}}`,
      `${PNPM}/@tesseract.js-data+{rus,kir}@*/node_modules/@tesseract.js-data/*/{package.json,index.js,4.0.0_best_int/*}`,
      `${PNPM}/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/{pdf,pdf.worker}.mjs`,
    ],
  },
  // Быстрые (менее точные) языковые данные, на которые указывают сами пакеты языков, не нужны. Пакеты
  // языков попадают и в следы страниц (общий серверный код с API), поэтому ключ — все маршруты.
  outputFileTracingExcludes: {
    '**': [`${PNPM}/@tesseract.js-data+*/node_modules/@tesseract.js-data/*/4.0.0/**`],
  },
};

export default config;
