import { createFakeTelegram, type FakeTelegram } from '@buhuchet/adapters';
import { hashPassword } from '@buhuchet/adapters/password';
import { schema } from '@buhuchet/db';
import { createOrganization, type CreatedOrganization } from '@buhuchet/db/organizations';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from '@buhuchet/db/testing';
import { TELEGRAM_TEMPLATE_DEFAULTS } from '@buhuchet/domain';
import { ApiError, MeResponse, TelegramLinkResponse } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import {
  createTestDeps,
  linkTelegram,
  sendToBot,
  signIn,
  telegramUpdate,
  TEST_ORIGIN as ORIGIN,
} from '../../testing';

const { auditLog, employees, platformReference, telegramLinkTokens, users } = schema;

const PASSWORD = 'Верный-пароль-1';
type App = ReturnType<typeof createApp>;

const post = (app: App, path: string, cookie?: string, method = 'POST') =>
  app.request(path, { method, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });

async function errorCode(res: Response): Promise<string> {
  return ApiError.parse(await res.json()).error.code;
}

async function me(app: App, cookie: string) {
  return MeResponse.parse(
    await (await app.request('/api/auth/me', { headers: { cookie } })).json(),
  );
}

async function linkUrl(app: App, cookie: string) {
  const res = await post(app, '/api/telegram/link', cookie);
  expect(res.status).toBe(200);
  return TelegramLinkResponse.parse(await res.json());
}

const tokenOf = (url: string) => new URL(url).searchParams.get('start')!;

describe.skipIf(!databaseAvailable())('Telegram: привязка по ссылке и вебхук бота', () => {
  let t: TestDatabase;
  let tg: FakeTelegram;
  let deps: ApiDeps;
  let app: App;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let accA: string;

  const lastText = () => tg.sent.at(-1)?.text;

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedAccessReference(t.admin.db);
    const passwordHash = await hashPassword(PASSWORD);
    await t.admin.db
      .insert(users)
      .values({ login: 'platform-admin', passwordHash, isPlatformAdmin: true });
    const org = (name: string, inn: string, slug: string, owner: string) =>
      createOrganization(t.app.db, {
        name,
        inn,
        slug,
        owner: { fullName: `Владелец ${owner}`, login: owner, passwordHash },
      });
    a = await org('Организация А', '01811201810456', 'org-a', 'owner-a');
    b = await org('Организация Б', '02811201810457', 'org-b', 'owner-b');
    await t.admin.db.update(users).set({ mustChangePassword: false });
    const [u] = await t.admin.db
      .insert(users)
      .values({ orgId: a.orgId, login: 'acc-a', passwordHash })
      .returning({ id: users.id });
    accA = u!.id;
    await t.admin.db.insert(employees).values({
      orgId: a.orgId,
      userId: accA,
      fullName: 'Асанов Алишер',
      shortName: 'Асанов А.',
      roleId: a.roles.find((r) => r.templateCode === 'acc')!.id,
    });
  });

  beforeEach(() => {
    tg = createFakeTelegram();
    deps = createTestDeps({ db: t.app.db, telegram: tg });
    app = createApp(deps);
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('ссылка из профиля: t.me/бот?start=токен, одноразовая, 15 минут; без входа — 401', async () => {
    expect((await post(app, '/api/telegram/link')).status).toBe(401);
    const cookie = await signIn(app, 'owner-a', PASSWORD);
    const before = Date.now();
    const { url, expiresAt } = await linkUrl(app, cookie);
    expect(url).toMatch(/^https:\/\/t\.me\/buhuchet_test_bot\?start=[A-Za-z0-9_-]{43}$/);
    const minutes = (Date.parse(expiresAt) - before) / 60_000;
    expect(minutes).toBeGreaterThan(14.9);
    expect(minutes).toBeLessThan(15.1);
    // Ссылка изменяет данные — только с нашего сайта.
    const evil = await app.request('/api/telegram/link', {
      method: 'POST',
      headers: { origin: 'https://evil.example', cookie },
    });
    expect(evil.status).toBe(403);
  });

  it('бот не подключён — ссылки нет (503), вебхука как будто нет (404)', async () => {
    const noBot = createApp(createTestDeps({ db: t.app.db, telegram: null }));
    const cookie = await signIn(noBot, 'owner-a', PASSWORD);
    const res = await post(noBot, '/api/telegram/link', cookie);
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe('telegram_unavailable');
    expect((await sendToBot(noBot, telegramUpdate('/start', 1))).status).toBe(404);
  });

  it('вебхук принимается только с секретом, до разбора тела', async () => {
    expect((await sendToBot(app, telegramUpdate('/start', 1), null)).status).toBe(401);
    expect((await sendToBot(app, telegramUpdate('/start', 1), 'wrong-secret-0000000')).status).toBe(
      401,
    );
    expect((await sendToBot(app, { nope: true }, null)).status).toBe(401);
    expect((await sendToBot(app, { nope: true })).status).toBe(400);
    expect(tg.sent).toEqual([]);
  });

  it('«/start токен»: чат привязан, бот подтвердил, «кто я» показывает Telegram, запись в истории', async () => {
    const cookie = await signIn(app, 'owner-a', PASSWORD);
    expect((await me(app, cookie)).telegram).toBeNull();
    const { url } = await linkUrl(app, cookie);
    const update = telegramUpdate(`/start ${tokenOf(url)}`, 5001, { username: 'erkin_s' });
    const res = await sendToBot(app, update);
    expect(res.status).toBe(200);
    expect(tg.sent).toEqual([
      {
        chatId: 5001,
        text: TELEGRAM_TEMPLATE_DEFAULTS.tgLinked.replace('{логин}', 'owner-a'),
        options: {},
      },
    ]);
    expect((await me(app, cookie)).telegram).toMatchObject({ name: '@erkin_s' });
    const history = await t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, a.ownerUserId)));
    expect(history.at(-1)).toMatchObject({
      action: 'update',
      actorUserId: a.ownerUserId,
      changes: [{ field: 'telegram', from: null, to: '@erkin_s' }],
    });

    // Telegram повторил то же сообщение — второй раз бот молчит.
    expect((await sendToBot(app, update)).status).toBe(200);
    expect(tg.sent).toHaveLength(1);
    // Ссылку, которую уже использовали, из другого чата не применить.
    await sendToBot(app, telegramUpdate(`/start ${tokenOf(url)}`, 6666));
    expect(lastText()).toBe(TELEGRAM_TEMPLATE_DEFAULTS.tgLinkInvalid);
    expect((await me(app, cookie)).telegram).toMatchObject({ name: '@erkin_s' });
  });

  it('новая ссылка заменяет прежнюю; истёкшая и чужая не действуют', async () => {
    const cookie = await signIn(app, 'acc-a', PASSWORD);
    const first = await linkUrl(app, cookie);
    const second = await linkUrl(app, cookie);
    await sendToBot(app, telegramUpdate(`/start ${tokenOf(first.url)}`, 7001));
    expect(lastText()).toBe(TELEGRAM_TEMPLATE_DEFAULTS.tgLinkInvalid);

    await t.admin.db
      .update(telegramLinkTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(telegramLinkTokens.userId, accA));
    await sendToBot(app, telegramUpdate(`/start ${tokenOf(second.url)}`, 7001));
    expect(lastText()).toBe(TELEGRAM_TEMPLATE_DEFAULTS.tgLinkInvalid);
    await sendToBot(app, telegramUpdate(`/start ${'x'.repeat(43)}`, 7001));
    expect(lastText()).toBe(TELEGRAM_TEMPLATE_DEFAULTS.tgLinkInvalid);
    await sendToBot(app, telegramUpdate('/start короткий', 7001));
    expect(lastText()).toBe(TELEGRAM_TEMPLATE_DEFAULTS.tgLinkInvalid);
    expect((await me(app, cookie)).telegram).toBeNull();

    // Имени пользователя в Telegram нет — показывается имя.
    const third = await linkUrl(app, cookie);
    await sendToBot(
      app,
      telegramUpdate(`/start ${tokenOf(third.url)}`, 7001, { firstName: 'Алишер' }),
    );
    expect((await me(app, cookie)).telegram).toMatchObject({ name: 'Алишер' });
  });

  it('другой Telegram вместо прежнего — бот пишет об этом в прежний чат', async () => {
    const cookie = await signIn(app, 'acc-a', PASSWORD);
    await linkTelegram(app, cookie, 7003, 'new_tg');
    expect(tg.sent.map((m) => m.chatId)).toEqual([7001, 7003]);
    expect(tg.sent[0]!.text).toBe(
      TELEGRAM_TEMPLATE_DEFAULTS.tgRelinked
        .replace('{логин}', 'acc-a')
        .replace('{телеграм}', '@new_tg'),
    );
    // Тот же чат ещё раз — сообщения о замене нет.
    await linkTelegram(app, cookie, 7003, 'new_tg');
    expect(tg.sent.map((m) => m.chatId)).toEqual([7001, 7003, 7003]);
  });

  it('просто /start, другой текст — подсказка; группы и боты — без ответа', async () => {
    await sendToBot(app, telegramUpdate('/start', 9001));
    expect(lastText()).toBe(TELEGRAM_TEMPLATE_DEFAULTS.tgStart);
    await sendToBot(app, telegramUpdate('привет', 9001));
    expect(tg.sent).toHaveLength(2);
    await sendToBot(app, telegramUpdate('/start', -100123, { chatType: 'group' }));
    await sendToBot(app, telegramUpdate('/start', 9002, { isBot: true }));
    await sendToBot(app, { update_id: 1, edited_message: { text: '/start' } });
    expect(tg.sent).toHaveLength(2);
  });

  it('шаблон справочника платформы главнее текста по умолчанию', async () => {
    await t.admin.db.insert(platformReference).values({
      key: 'messageTemplates',
      payload: { tgStart: 'Привязка — в профиле.' },
      checksum: 'x',
      source: 'test',
    });
    await sendToBot(app, telegramUpdate('/start', 9001));
    expect(lastText()).toBe('Привязка — в профиле.');
    await t.admin.db.delete(platformReference).where(eq(platformReference.key, 'messageTemplates'));
  });

  it('один Telegram у логинов разных организаций — в сообщениях указана организация', async () => {
    const cookie = await signIn(app, 'owner-b', PASSWORD);
    await linkTelegram(app, cookie, 5001, 'erkin_s');
    expect(lastText()).toBe(
      `Организация Б\n${TELEGRAM_TEMPLATE_DEFAULTS.tgLinked.replace('{логин}', 'owner-b')}`,
    );
  });

  it('заблокированному сотруднику ссылка не поможет', async () => {
    const cookie = await signIn(app, 'acc-a', PASSWORD);
    const { url } = await linkUrl(app, cookie);
    await t.admin.db.update(employees).set({ active: false }).where(eq(employees.userId, accA));
    await sendToBot(app, telegramUpdate(`/start ${tokenOf(url)}`, 7002));
    expect(lastText()).toBe(TELEGRAM_TEMPLATE_DEFAULTS.tgLinkInvalid);
    await t.admin.db.update(employees).set({ active: true }).where(eq(employees.userId, accA));
  });

  it('отвязать: Telegram больше не показан, запись в истории; без Origin — нельзя', async () => {
    const cookie = await signIn(app, 'owner-b', PASSWORD);
    const noOrigin = await app.request('/api/telegram/link', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(noOrigin.status).toBe(403);
    expect((await post(app, '/api/telegram/link', cookie, 'DELETE')).status).toBe(200);
    expect((await me(app, cookie)).telegram).toBeNull();
    // Бот сообщает об отвязке в отвязанный чат; он остался у owner-a — с организацией.
    expect(tg.sent).toEqual([
      {
        chatId: 5001,
        text: `Организация Б\n${TELEGRAM_TEMPLATE_DEFAULTS.tgUnlinked.replace('{логин}', 'owner-b')}`,
        options: {},
      },
    ]);
    expect((await post(app, '/api/telegram/link', cookie, 'DELETE')).status).toBe(200);
    expect(tg.sent).toHaveLength(1);
    const history = await t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, b.ownerUserId)));
    expect(history.at(-1)).toMatchObject({
      changes: [{ field: 'telegram', from: '@erkin_s', to: null }],
    });
  });

  it('администратор платформы тоже привязывает Telegram (без организации)', async () => {
    const cookie = await signIn(app, 'platform-admin', PASSWORD);
    await linkTelegram(app, cookie, 8001, 'admin_tg');
    expect(lastText()).toBe(
      TELEGRAM_TEMPLATE_DEFAULTS.tgLinked.replace('{логин}', 'platform-admin'),
    );
    expect((await me(app, cookie)).telegram).toMatchObject({ name: '@admin_tg' });
    expect((await post(app, '/api/telegram/link', cookie, 'DELETE')).status).toBe(200);
    expect((await me(app, cookie)).telegram).toBeNull();
    expect(tg.sent.at(-1)).toMatchObject({
      chatId: 8001,
      text: TELEGRAM_TEMPLATE_DEFAULTS.tgUnlinked.replace('{логин}', 'platform-admin'),
    });
  });

  it('ошибка Telegram не роняет вебхук', async () => {
    tg.failNext({ ok: false, errorCode: 403, description: 'blocked', permanent: true });
    expect((await sendToBot(app, telegramUpdate('/start', 9003))).status).toBe(200);
    const throwing = createApp(
      createTestDeps({
        db: t.app.db,
        telegram: {
          ...createFakeTelegram(),
          sendMessage: () => Promise.reject(new Error('сеть недоступна')),
        },
      }),
    );
    expect((await sendToBot(throwing, telegramUpdate('/start', 9003))).status).toBe(200);
  });
});
