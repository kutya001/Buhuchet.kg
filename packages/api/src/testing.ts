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
    config: {
      APP_ENV: 'test',
      APP_VERSION: '0.0.0-test',
      APP_BASE_URL: 'http://localhost:3000',
      CRON_SECRET: 'test-cron-secret-0000',
    },
    db: unavailableDb(),
    storage: createMemoryStorage(),
    clock: fixedClock('2026-10-18T03:00:00Z'),
    logger: createLogger({ level: 'silent', environment: 'test', version: 'test', service: 'web' }),
    telegram: createFakeTelegram(),
    jobs: [],
    ...overrides,
  };
}

/** Origin, с которым тесты шлют изменяющие запросы (`app.request` идёт на http://localhost). */
export const TEST_ORIGIN = 'http://localhost';

/** Cookie сеанса из ответа входа или смены пароля — «bh_session=…» для следующих запросов. */
export function cookieOf(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  const match = /(?:^|,\s*)((?:__Host-)?bh_session=[A-Za-z0-9_-]+)/.exec(header);
  if (!match) throw new Error(`нет cookie сеанса: ${header}`);
  return match[1]!;
}

/** Войти и получить cookie: `const cookie = await signIn(app, 'chief-a', пароль)`. */
export async function signIn(
  app: { request: (path: string, init: RequestInit) => Response | Promise<Response> },
  login: string,
  password: string,
): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  if (res.status !== 200) throw new Error(`вход ${login}: ${res.status} ${await res.text()}`);
  return cookieOf(res);
}
