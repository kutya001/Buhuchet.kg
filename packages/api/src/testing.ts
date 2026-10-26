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

/** Секрет вебхука бота в тестах (заголовок X-Telegram-Bot-Api-Secret-Token). */
export const TEST_WEBHOOK_SECRET = 'test-webhook-secret-0000';

/** Зависимости API для тестов: память вместо S3, часы 18.10.2026 09:00 по Бишкеку, бот-подделка. */
export function createTestDeps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  return {
    config: {
      APP_ENV: 'test',
      APP_VERSION: '0.0.0-test',
      APP_BASE_URL: 'http://localhost:3000',
      CRON_SECRET: 'test-cron-secret-0000',
      TELEGRAM_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      TELEGRAM_BOT_USERNAME: 'buhuchet_test_bot',
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

type RequestApp = { request: (path: string, init: RequestInit) => Response | Promise<Response> };

let nextUpdateId = 1;

/** Обновление Telegram с текстом в личном чате — как его присылает вебхук. */
export function telegramUpdate(
  text: string,
  chatId: number,
  options: { username?: string; firstName?: string; chatType?: string; isBot?: boolean } = {},
) {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      date: 1_792_972_800,
      text,
      chat: { id: chatId, type: options.chatType ?? 'private' },
      from: {
        id: chatId,
        is_bot: options.isBot ?? false,
        first_name: options.firstName ?? 'Тест',
        ...(options.username ? { username: options.username } : {}),
      },
    },
  };
}

/** Прислать обновление в вебхук бота (без Origin, как Telegram), с секретом вебхука. */
export function sendToBot(
  app: RequestApp,
  update: unknown,
  secret: string | null = TEST_WEBHOOK_SECRET,
) {
  return app.request('/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret }),
    },
    body: JSON.stringify(update),
  });
}

/** Привязать Telegram вошедшему пользователю: ссылка из профиля → «/start токен» в бот. */
export async function linkTelegram(
  app: RequestApp,
  cookie: string,
  chatId: number,
  username?: string,
): Promise<void> {
  const res = await app.request('/api/telegram/link', {
    method: 'POST',
    headers: { origin: TEST_ORIGIN, cookie },
  });
  if (res.status !== 200) throw new Error(`ссылка Telegram: ${res.status} ${await res.text()}`);
  const { url } = (await res.json()) as { url: string };
  const token = new URL(url).searchParams.get('start')!;
  const bot = await sendToBot(app, telegramUpdate(`/start ${token}`, chatId, { username }));
  if (bot.status !== 200) throw new Error(`вебхук: ${bot.status} ${await bot.text()}`);
}
