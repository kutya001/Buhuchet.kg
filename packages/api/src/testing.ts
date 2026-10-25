import {
  createFakeTelegram,
  createLogger,
  createMemoryStorage,
  fixedClock,
} from '@buhuchet/adapters';
import type { Db } from '@buhuchet/db';
import type { ApiDeps } from './deps';

/** База-заглушка для тестов без PostgreSQL: любой запрос падает с понятной ошибкой. */
export function unavailableDb(): Db {
  return new Proxy({} as Db, {
    get() {
      return () => Promise.reject(new Error('база недоступна в этом тесте'));
    },
  });
}

/** Зависимости API для тестов: память вместо S3, часы 18.10.2026 09:00 по Бишкеку, бот-подделка. */
export function createTestDeps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  return {
    config: { APP_ENV: 'test', APP_VERSION: '0.0.0-test', CRON_SECRET: 'test-cron-secret-0000' },
    db: unavailableDb(),
    storage: createMemoryStorage(),
    clock: fixedClock('2026-10-18T03:00:00Z'),
    logger: createLogger({ level: 'silent', environment: 'test', version: 'test', service: 'web' }),
    telegram: createFakeTelegram(),
    jobs: [],
    ...overrides,
  };
}
