import {
  createFakeTelegram,
  createLogger,
  createMemoryStorage,
  fixedClock,
} from '@buhuchet/adapters';
import { hashPassword } from '@buhuchet/adapters/password';
import { schema, type Db } from '@buhuchet/db';
import { createOrganization, type CreatedOrganization } from '@buhuchet/db/organizations';
import { createTestDatabase, seedAccessReference, seedPhoneCodes } from '@buhuchet/db/testing';
import { SCOPE_GROUPS } from '@buhuchet/domain';
import { eq } from 'drizzle-orm';
import { createApp } from './app';
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
    resetResponseFloorMs: 0,
    l10nRecheckMs: 0,
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

/** Запрос к API от вошедшего пользователя: Origin нашего сайта, тело — JSON. */
export function apiRequest(
  app: RequestApp,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  cookie?: string,
  body?: unknown,
) {
  return app.request(path, {
    method,
    headers: {
      origin: TEST_ORIGIN,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Пароль всех учётных записей `createStaffFixture`. */
export const TEST_PASSWORD = 'Верный-пароль-1';

/**
 * База для тестов модулей «Сотрудники» и «Роли»: организации А и Б с владельцами owner-a и owner-b
 * (временный пароль уже сменён), администратор платформы platform-admin; в А — chief-a и acc-a по
 * шаблонам ролей, роли «Кадры» (права «Бухгалтера», staffView и staff — их выдал владелец; область
 * «Свои») с hr-a и «Старший» (cpView и rollback) с senior-a; в Б — acc-b. «Главный бухгалтер» шире
 * «Кадров» (финансы без своих прав, «Видеть все…»), «Бухгалтер» — нет. Справочник «Коды телефонов»
 * загружен.
 */
export async function createStaffFixture() {
  const t = await createTestDatabase();
  await seedAccessReference(t.admin.db);
  await seedPhoneCodes(t.admin.db);
  const passwordHash = await hashPassword(TEST_PASSWORD);
  await t.admin.db
    .insert(schema.users)
    .values({ login: 'platform-admin', passwordHash, isPlatformAdmin: true });
  const org = (name: string, inn: string, slug: string, owner: string) =>
    createOrganization(t.app.db, {
      name,
      inn,
      slug,
      owner: { fullName: `Владелец ${owner}`, login: owner, passwordHash },
    });
  const a = await org('Организация А', '01811201810456', 'org-a', 'owner-a');
  const b = await org('Организация Б', '02811201810457', 'org-b', 'owner-b');
  await t.admin.db.update(schema.users).set({ mustChangePassword: false });

  const templateRole = (o: CreatedOrganization, code: string) =>
    o.roles.find((r) => r.templateCode === code)!.id;
  const accPermissions = (
    await t.admin.db
      .select({ id: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, templateRole(a, 'acc')))
  ).map((r) => r.id);

  const roleIds: Record<'hr' | 'senior', string> = { hr: '', senior: '' };
  const custom: ['hr' | 'senior', string, string[]][] = [
    ['hr', 'Кадры', [...accPermissions, 'staffView', 'staff']],
    ['senior', 'Старший', ['cpView', 'rollback']],
  ];
  for (const [key, name, permissions] of custom) {
    const [role] = await t.admin.db
      .insert(schema.roles)
      .values({ orgId: a.orgId, name })
      .returning({ id: schema.roles.id });
    roleIds[key] = role!.id;
    await t.admin.db
      .insert(schema.rolePermissions)
      .values(
        permissions.map((permissionId) => ({ orgId: a.orgId, roleId: role!.id, permissionId })),
      );
    await t.admin.db.insert(schema.roleScopes).values(
      SCOPE_GROUPS.map((g) => ({
        orgId: a.orgId,
        roleId: role!.id,
        permGroup: g,
        scope: 'own' as const,
      })),
    );
  }

  const people: Record<string, { userId: string; employeeId: string }> = {};
  for (const [o, login, roleId] of [
    [a, 'chief-a', templateRole(a, 'chief')],
    [a, 'acc-a', templateRole(a, 'acc')],
    [a, 'hr-a', roleIds.hr],
    [a, 'senior-a', roleIds.senior],
    [b, 'acc-b', templateRole(b, 'acc')],
  ] as const) {
    const [user] = await t.admin.db
      .insert(schema.users)
      .values({ orgId: o.orgId, login, passwordHash })
      .returning({ id: schema.users.id });
    const [employee] = await t.admin.db
      .insert(schema.employees)
      .values({
        orgId: o.orgId,
        userId: user!.id,
        fullName: `Сотрудник ${login}`,
        shortName: login,
        roleId,
      })
      .returning({ id: schema.employees.id });
    people[login] = { userId: user!.id, employeeId: employee!.id };
  }
  const deps = createTestDeps({ db: t.app.db });
  return { t, deps, app: createApp(deps), a, b, roleIds, templateRole, people };
}
