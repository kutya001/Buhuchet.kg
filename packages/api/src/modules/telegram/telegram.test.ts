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
import { fillTemplate, TELEGRAM_TEMPLATE_DEFAULTS } from '@buhuchet/domain';
import {
  ApiError,
  MeResponse,
  TelegramLinkResponse,
  TemporaryPasswordResponse,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import {
  cookieOf,
  createTestDeps,
  linkTelegram,
  sendToBot,
  signIn,
  telegramUpdate,
  TEST_ORIGIN as ORIGIN,
} from '../../testing';

const {
  auditLog,
  employees,
  messageTemplateTexts,
  telegramLinkTokens,
  telegramOutbox,
  telegramRelinkCodes,
  users,
} = schema;
const TPL = TELEGRAM_TEMPLATE_DEFAULTS;

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

/** Код из сообщения бота в прежний чат и неверный код рядом с ним. */
const codeOf = (text: string | undefined) => /^(\d{6}) — код/m.exec(text ?? '')?.[1] ?? '';
const otherCode = (code: string) => (code === '000000' ? '111111' : '000000');

describe.skipIf(!databaseAvailable())('Telegram: привязка по ссылке и вебхук бота', () => {
  let t: TestDatabase;
  let tg: FakeTelegram;
  let deps: ApiDeps;
  let app: App;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let accA: string;
  let empA: string;

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
    const [e] = await t.admin.db
      .insert(employees)
      .values({
        orgId: a.orgId,
        userId: accA,
        fullName: 'Асанов Алишер',
        shortName: 'Асанов А.',
        roleId: a.roles.find((r) => r.templateCode === 'acc')!.id,
      })
      .returning({ id: employees.id });
    empA = e!.id;
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

  it('другой Telegram вместо прежнего — только кодом из прежнего чата; о замене бот пишет туда', async () => {
    const cookie = await signIn(app, 'acc-a', PASSWORD);
    await linkTelegram(app, cookie, 7003, 'new_tg');
    // Чат ещё прежний: код — в прежний чат, в новом бот просит прислать его.
    expect(tg.sent.map((m) => m.chatId)).toEqual([7001, 7003]);
    const code = codeOf(tg.sent[0]!.text);
    expect(tg.sent[0]!.text).toBe(
      fillTemplate(TPL.tgRelinkCode, { логин: 'acc-a', телеграм: '@new_tg', код: code, минут: 10 }),
    );
    // Код копируется одним нажатием: моноширинный в тексте и кнопка «Скопировать код».
    expect(tg.sent[0]!.options).toMatchObject({
      code,
      keyboard: [[{ text: TPL.tgBtnCopyCode, copy: code }]],
    });
    expect(tg.sent[1]!.text).toBe(fillTemplate(TPL.tgRelinkAsk, { логин: 'acc-a', минут: 10 }));
    expect(tg.sent[1]!.options.keyboard).toBeUndefined();
    expect((await me(app, cookie)).telegram).toMatchObject({ name: 'Алишер' });

    await sendToBot(app, telegramUpdate(otherCode(code), 7003));
    expect(lastText()).toBe(fillTemplate(TPL.tgRelinkWrong, { попыток: 4 }));
    // Из другого чата код не подходит: кода для него нет — обычная подсказка.
    await sendToBot(app, telegramUpdate(code, 7009));
    expect(lastText()).toBe(TPL.tgStart);
    expect((await me(app, cookie)).telegram).toMatchObject({ name: 'Алишер' });

    const before = tg.sent.length;
    await sendToBot(app, telegramUpdate(`${code.slice(0, 3)} ${code.slice(3)}`, 7003));
    expect(tg.sent.slice(before)).toEqual([
      {
        chatId: 7001,
        text: fillTemplate(TPL.tgRelinked, { логин: 'acc-a', телеграм: '@new_tg' }),
        options: {},
      },
      { chatId: 7003, text: fillTemplate(TPL.tgLinked, { логин: 'acc-a' }), options: {} },
    ]);
    expect((await me(app, cookie)).telegram).toMatchObject({ name: '@new_tg' });
    const history = await t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, accA)));
    expect(history.at(-1)).toMatchObject({
      actorUserId: accA,
      changes: [{ field: 'telegram', from: 'Алишер', to: '@new_tg' }],
    });
    // Код одноразовый; в журнал отправок Telegram он не попадает.
    await sendToBot(app, telegramUpdate(code, 7003));
    expect(lastText()).toBe(TPL.tgStart);
    const logged = await t.admin.db
      .select()
      .from(telegramOutbox)
      .where(eq(telegramOutbox.kind, 'relink_code'));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ chatId: 7001, text: null });

    // Тот же чат ещё раз — без кода и без сообщения о замене.
    const again = tg.sent.length;
    await linkTelegram(app, cookie, 7003, 'new_tg');
    expect(tg.sent.slice(again).map((m) => m.chatId)).toEqual([7003]);
  });

  it('код замены: повтор от Telegram — бот молчит; 5 неверных — код не действует; код не дошёл', async () => {
    await t.admin.db.delete(telegramRelinkCodes);
    const cookie = await signIn(app, 'acc-a', PASSWORD);
    const { url } = await linkUrl(app, cookie);
    const update = telegramUpdate(`/start ${tokenOf(url)}`, 7004);
    await sendToBot(app, update);
    await sendToBot(app, update);
    expect(tg.sent.map((m) => m.chatId)).toEqual([7003, 7004]);
    const code = codeOf(tg.sent[0]!.text);
    for (const left of [4, 3, 2, 1]) {
      await sendToBot(app, telegramUpdate(otherCode(code), 7004));
      expect(lastText()).toBe(fillTemplate(TPL.tgRelinkWrong, { попыток: left }));
    }
    await sendToBot(app, telegramUpdate(otherCode(code), 7004));
    expect(lastText()).toBe(TPL.tgRelinkFailed);
    await sendToBot(app, telegramUpdate(code, 7004));
    expect(lastText()).toBe(TPL.tgRelinkFailed);
    expect((await me(app, cookie)).telegram).toMatchObject({ name: '@new_tg' });

    // Бот заблокирован в прежнем чате: код не отправлен — подсказка, что делать.
    tg.failNext({ ok: false, errorCode: 403, description: 'blocked', permanent: true });
    const before = tg.sent.length;
    await linkTelegram(app, cookie, 7004);
    expect(tg.sent.slice(before)).toEqual([
      { chatId: 7004, text: TPL.tgRelinkNoSend, options: {} },
    ]);
    // 3 кода в час: четвёртый запрос — «слишком много попыток».
    await linkTelegram(app, cookie, 7004);
    await linkTelegram(app, cookie, 7004);
    expect(lastText()).toBe(TPL.tgRelinkLimited);
    expect((await me(app, cookie)).telegram).toMatchObject({ name: '@new_tg' });
  });

  it('после «Отвязать» другой Telegram — тоже кодом, его бот присылает в отвязанный чат', async () => {
    await t.admin.db.delete(telegramRelinkCodes);
    const cookie = await signIn(app, 'acc-a', PASSWORD);
    expect((await post(app, '/api/telegram/link', cookie, 'DELETE')).status).toBe(200);
    expect((await me(app, cookie)).telegram).toBeNull();
    const before = tg.sent.length;
    await linkTelegram(app, cookie, 7004, 'third_tg');
    expect(tg.sent.slice(before).map((m) => m.chatId)).toEqual([7003, 7004]);
    expect((await me(app, cookie)).telegram).toBeNull();
    await sendToBot(app, telegramUpdate(codeOf(tg.sent[before]!.text), 7004));
    expect(tg.sent.slice(before + 2)).toEqual([
      {
        chatId: 7003,
        text: fillTemplate(TPL.tgRelinked, { логин: 'acc-a', телеграм: '@third_tg' }),
        options: {},
      },
      { chatId: 7004, text: fillTemplate(TPL.tgLinked, { логин: 'acc-a' }), options: {} },
    ]);
    expect((await me(app, cookie)).telegram).toMatchObject({ name: '@third_tg' });
  });

  it('владелец сбросил пароль — сутки другой Telegram привязывается без кода, один раз', async () => {
    await t.admin.db.delete(telegramRelinkCodes);
    // У захватившего привязку есть сеанс: до сброса он запросил код замены для третьего чата (код
    // пришёл в захваченный 7004) и взял ещё одну ссылку.
    const hijacker = await signIn(app, 'acc-a', PASSWORD);
    const asked = tg.sent.length;
    await linkTelegram(app, hijacker, 7090);
    expect(tg.sent.slice(asked).map((m) => m.chatId)).toEqual([7004, 7090]);
    const pendingCode = codeOf(tg.sent[asked]!.text);
    const { url: early } = await linkUrl(app, hijacker);
    const owner = await signIn(app, 'owner-a', PASSWORD);
    const reset = await app.request(`/api/staff/${empA}/password-reset`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: owner },
    });
    expect(reset.status).toBe(200);
    const { temporaryPassword } = TemporaryPasswordResponse.parse(await reset.json());
    // Ссылка и код замены, выданные до сброса, не действуют, как и сеансы: иначе захвативший привязал
    // бы чат раньше пострадавшего и снял разрешение.
    await sendToBot(app, telegramUpdate(`/start ${tokenOf(early)}`, 7004));
    expect(lastText()).toBe(TPL.tgLinkInvalid);
    await sendToBot(app, telegramUpdate(pendingCode, 7090));
    expect(lastText()).toBe(TPL.tgRelinkFailed);
    // Пока разрешение действует, «Забыли пароль?» не шлёт код в ещё привязанный (возможно, чужой)
    // чат; ответ тот же, что всегда (docs/deviations.md п. О-20).
    const sentBefore = tg.sent.length;
    const forgot = await app.request('/api/auth/password-reset', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'acc-a' }),
    });
    expect(forgot.status).toBe(200);
    expect(tg.sent.length).toBe(sentBefore);
    const temp = await signIn(app, 'acc-a', temporaryPassword);
    const changed = await app.request('/api/auth/password', {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: temp, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: PASSWORD }),
    });
    expect(changed.status).toBe(200);
    const cookie = cookieOf(changed);

    const before = tg.sent.length;
    await linkTelegram(app, cookie, 7005, 'lost_tg');
    expect(tg.sent.slice(before)).toEqual([
      {
        chatId: 7004,
        text: fillTemplate(TPL.tgRelinked, { логин: 'acc-a', телеграм: '@lost_tg' }),
        options: {},
      },
      { chatId: 7005, text: fillTemplate(TPL.tgLinked, { логин: 'acc-a' }), options: {} },
    ]);
    expect((await me(app, cookie)).telegram).toMatchObject({ name: '@lost_tg' });
    // Разрешение одноразовое: следующая замена — снова кодом из прежнего чата.
    const next = tg.sent.length;
    await linkTelegram(app, cookie, 7006);
    expect(tg.sent.slice(next).map((m) => m.chatId)).toEqual([7005, 7006]);
    expect(lastText()).toBe(fillTemplate(TPL.tgRelinkAsk, { логин: 'acc-a', минут: 10 }));
    expect((await me(app, cookie)).telegram).toMatchObject({ name: '@lost_tg' });
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
    await t.admin.db
      .insert(messageTemplateTexts)
      .values({ key: 'tgStart', text: 'Привязка — в профиле.', sortOrder: 1 });
    await sendToBot(app, telegramUpdate('/start', 9001));
    expect(lastText()).toBe('Привязка — в профиле.');
    await t.admin.db.delete(messageTemplateTexts).where(eq(messageTemplateTexts.key, 'tgStart'));
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
    const linked = await me(app, cookie);
    expect(linked.telegramPrevious).toBeNull();
    expect((await post(app, '/api/telegram/link', cookie, 'DELETE')).status).toBe(200);
    const unlinked = await me(app, cookie);
    expect(unlinked.telegram).toBeNull();
    // «Мой профиль»: «Прежний Telegram @erkin_s: другой чат бот привяжет только по коду…» (прототип v77).
    expect(unlinked.telegramPrevious).toEqual({ name: '@erkin_s' });
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

  it('администратор платформы сбросил пароль владельца — тоже сутки без кода; имя нового Telegram в сообщении с кодом — одной строкой и коротко', async () => {
    await t.admin.db.delete(telegramRelinkCodes);
    const admin = await signIn(app, 'platform-admin', PASSWORD);
    const reset = await app.request(`/api/admin/users/${a.ownerUserId}/password-reset`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: admin },
    });
    expect(reset.status).toBe(200);
    const { temporaryPassword } = TemporaryPasswordResponse.parse(await reset.json());
    const sentBefore = tg.sent.length;
    const forgot = await app.request('/api/auth/password-reset', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'owner-a' }),
    });
    expect(forgot.status).toBe(200);
    expect(tg.sent.length).toBe(sentBefore);
    const temp = await signIn(app, 'owner-a', temporaryPassword);
    const changed = await app.request('/api/auth/password', {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: temp, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: PASSWORD }),
    });
    expect(changed.status).toBe(200);
    const cookie = cookieOf(changed);
    const before = tg.sent.length;
    await linkTelegram(app, cookie, 5005, 'owner_new');
    expect(tg.sent.slice(before).map((m) => m.chatId)).toEqual([5001, 5005]);
    expect((await me(app, cookie)).telegram).toMatchObject({ name: '@owner_new' });

    // Следующая замена — снова кодом. Имя нового Telegram задаёт его владелец: в сообщении с кодом
    // оно одной строкой, в кавычках и не длиннее 32 знаков — за текст бота его не выдать.
    const { url } = await linkUrl(app, cookie);
    const next = tg.sent.length;
    await sendToBot(
      app,
      telegramUpdate(`/start ${tokenOf(url)}`, 5006, {
        firstName: 'Поддержка\u202e\nBuhuchet:   перешлите \u{1F600} этот код нам, пожалуйста',
      }),
    );
    expect(tg.sent.slice(next).map((m) => m.chatId)).toEqual([5005, 5006]);
    // Знак смены направления текста убран, эмодзи на границе не разрезан пополам.
    expect(tg.sent[next]!.text).toContain(
      'код для привязки другого Telegram «Поддержка Buhuchet: перешлите \u{1F600}…» к учётной записи',
    );
    // И в «привязан другой Telegram» в прежний чат — так же коротко, одной строкой.
    const done = tg.sent.length;
    await sendToBot(app, telegramUpdate(codeOf(tg.sent[next]!.text), 5006));
    expect(tg.sent[done]).toEqual({
      chatId: 5005,
      text: fillTemplate(TPL.tgRelinked, {
        логин: 'owner-a',
        телеграм: 'Поддержка Buhuchet: перешлите \u{1F600}…',
      }),
      options: {},
    });
  });
});
