import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Локально настройки базы и S3 берутся из корневого .env (как в docker-compose), в CI — из окружения.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // runtime.ts и standalone.ts только собирают зависимости из окружения: их проверяют сквозные тесты в Docker.
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/runtime.ts',
        'src/standalone.ts',
        'src/testing.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
