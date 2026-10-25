import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Локально настройки базы и S3 берутся из корневого .env (как в docker-compose), в CI — из окружения.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Каждый файл тестов создаёт свою временную базу; общие роли сервера миграции создают по очереди.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
