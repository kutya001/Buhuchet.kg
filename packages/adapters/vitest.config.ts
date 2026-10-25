import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Локально настройки базы и S3 берутся из корневого .env (как в docker-compose), в CI — из окружения.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
