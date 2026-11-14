import { createFakeTelegram, type FakeTelegram } from '@buhuchet/adapters';
import { hashPassword } from '@buhuchet/adapters/password';
import {
  adminSetTelegramBotRich,
  schema,
  withOrgContext,
  withUserContext,
  writeHistory,
} from '@buhuchet/db';
import { createOrganization, type CreatedOrganization } from '@buhuchet/db/organizations';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from '@buhuchet/db/testing';
import { RecordChangedError, TELEGRAM_TEMPLATE_DEFAULTS, type BotMessage } from '@buhuchet/domain';
import { ApiError, MeResponse, OrgPolicy } from '@buhuchet/shared';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import {
  apiRequest,
  createTestDeps,
  linkTelegram,
  sendToBot,
  signIn,
  telegramPress,
} from '../../testing';
import { sendBotMessage } from './bot';
import { flushEvents, queueEvents } from './outbox';
import { BOT_PRESS_RATE_LIMIT, type BotAction, type BotPressContext } from './press';

const {
  auditLog,
  employees,
  organizations,
  rateLimits,
  telegramLinkGuards,
  telegramLinks,
  telegramOutbox,
  users,
} = schema;
const TPL = TELEGRAM_TEMPLATE_DEFAULTS;
const PASSWORD = 'Верный-пароль-1';
type App = ReturnType<typeof createApp>;

async function errorCode(res: Response): Promise<string> {
  return ApiError.parse(await res.json()).error.code;
}

describe.skipIf(!databaseAvailable())('Основа бота: сообщения с кнопками и нажатия (Т1)', () => {
  let t: TestDatabase;
  let tg: FakeTelegram;
  let deps: ApiDeps;
  let app: App;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let accA: string;
  let adminId: string;
  let seen: BotPressContext[];

  /** Действия теста: «mark» меняет данные и пишет в историю, «look» только отвечает. */
  const actions: Record<string, BotAction> = {
    mark: {
      change: true,
      run: async (ctx) => {
        seen.push(ctx);
        const visible = await ctx.asUser(async (tx, access) => {
          await writeHistory(tx, {
            entity: 'user',
            entityId: ctx.user.userId,
            action: 'update',
            changes: [{ field: 'botMark', to: ctx.arg }],
          });
          const rows = await tx.select({ orgId: employees.orgId }).from(employees);
          return { orgs: [...new Set(rows.map((r) => r.orgId))], owner: access?.subject.isOwner };
        });
        return {
          reply: `Готово: ${ctx.arg}; организаций видно: ${visible.orgs.length}; владелец: ${visible.owner}`,
          done: 'Сдан ✓',
          off: ['look'],
        };
      },
    },
    look: { run: async (ctx) => ({ reply: `Смотрю ${ctx.arg}`, alert: true }) },
    boom: {
      run: async () => {
        throw new Error('сбой действия');
      },
    },
    stale: {
      run: async () => {
        throw new RecordChangedError('report', 'r1', 2);
      },
    },
    ask: {
      run: async () => ({
        send: { message: { text: 'Пришлите файл отчёта.' }, kind: 'bot_test' },
      }),
    },
    // Действие с правом: «Настройки и учётная политика» есть только у владельца.
    perm: {
      permission: 'org',
      run: async (ctx) => {
        seen.push(ctx);
        return { reply: 'Право есть' };
      },
    },
    who: {
      change: true,
      run: async (ctx) => {
        const who = await ctx.asUser(async (_tx, access) =>
          access ? 'сотрудник' : 'не сотрудник',
        );
        return { reply: `${who}; администратор платформы: ${ctx.user.isPlatformAdmin}` };
      },
    },
  };

  const message: BotMessage = {
    heading: 'Сегодня срок',
    text: 'НДС за октябрь',
    tables: [{ head: ['Контрагент', 'Отчёт'], rows: [['ОсОО «Ромашка»', 'НДС']] }],
    buttons: [
      [
        { text: 'Сдан', action: 'mark', arg: 'r1' },
        { text: 'Открыть', action: 'look', arg: 'r1' },
      ],
      [
        { text: 'Сбой', action: 'boom' },
        { text: 'Устарело', action: 'stale' },
        { text: 'Файл', action: 'ask' },
      ],
    ],
  };

  const extra: BotMessage = {
    text: 'Проверка прав',
    buttons: [
      [
        { text: 'Право', action: 'perm' },
        { text: 'Кто', action: 'who' },
      ],
    ],
  };

  const press = (data: string, chatId: number, messageId: number, o = {}) =>
    sendToBot(app, telegramPress(data, chatId, messageId, o));
  const lastAnswer = () => tg.answers.at(-1);
  /** Отправить сообщение с кнопками сразу и вернуть его номер в чате. */
  async function send(userId: string, chatId: number, m: BotMessage = message): Promise<number> {
    expect(await sendBotMessage(deps, { userId, chatId }, m, 'bot_test', 'test')).toBe(true);
    return tg.messageIds.at(-1)!;
  }
  const policyOf = async (cookie: string) =>
    OrgPolicy.parse(await (await apiRequest(app, 'GET', '/api/org/policy', cookie)).json());
  const setActions = async (cookie: string, on: boolean) =>
    apiRequest(app, 'PATCH', '/api/org/policy', cookie, {
      version: (await policyOf(cookie)).version,
      telegramActions: on,
    });

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedAccessReference(t.admin.db);
    const passwordHash = await hashPassword(PASSWORD);
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
      .values({ orgId: a.orgId, login: 'chief-a', passwordHash })
      .returning({ id: users.id });
    accA = u!.id;
    // Главный бухгалтер: не владелец — «Настройки и учётная политика» ему недоступны.
    const chiefRole = a.roles.find((r) => r.templateCode === 'chief')!.id;
    await t.admin.db.insert(employees).values({
      orgId: a.orgId,
      userId: accA,
      fullName: 'Асанова Мээрим',
      shortName: 'Асанова М.',
      roleId: chiefRole,
    });
    const [admin] = await t.admin.db
      .insert(users)
      .values({ login: 'platform-bot', passwordHash, isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
  });

  beforeEach(() => {
    tg = createFakeTelegram();
    seen = [];
    deps = createTestDeps({ db: t.app.db, telegram: tg, botActions: actions });
    app = createApp(deps);
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('«Проверить бота»: сообщение с таблицей и кнопкой, нажатие — скрытый ответ; без Telegram — 409, без входа — 401', async () => {
    deps = createTestDeps({ db: t.app.db, telegram: tg });
    app = createApp(deps);
    expect((await apiRequest(app, 'POST', '/api/telegram/test')).status).toBe(401);
    const cookie = await signIn(app, 'owner-a', PASSWORD);
    const none = await apiRequest(app, 'POST', '/api/telegram/test', cookie);
    expect(none.status).toBe(409);
    expect(await errorCode(none)).toBe('telegram_not_linked');

    await linkTelegram(app, cookie, 6001);
    const from = tg.sent.length;
    expect((await apiRequest(app, 'POST', '/api/telegram/test', cookie)).status).toBe(200);
    const sent = tg.sent[from]!;
    expect(sent.chatId).toBe(6001);
    expect(sent.text).toBe(
      [
        'Проверка бота',
        TPL.tgTest,
        '• Таблица — столбцами, как здесь',
        '• Кнопки — под сообщением',
        '• Скрытый ответ — после нажатия кнопки',
      ].join('\n'),
    );
    expect(sent.options.rich).toContain('<table bordered compact><tr><th>Что проверяем</th>');
    expect(sent.options.keyboard).toEqual([[{ text: 'Проверить кнопки', data: 'test' }]]);

    // В журнале отправок — вид «Проверка бота», описание сообщения и номер в чате.
    const [row] = await t.admin.db
      .select()
      .from(telegramOutbox)
      .where(eq(telegramOutbox.kind, 'bot_test'))
      .orderBy(desc(telegramOutbox.createdAt));
    expect(row).toMatchObject({
      orgId: a.orgId,
      userId: a.ownerUserId,
      status: 'sent',
      messageId: tg.messageIds.at(-1),
    });
    expect(row!.payload?.buttons).toEqual([[{ text: 'Проверить кнопки', action: 'test' }]]);

    // Нажатие: скрытый ответ строкой, кнопка остаётся активной — проверять можно снова.
    expect((await press('test', 6001, tg.messageIds.at(-1)!)).status).toBe(200);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgTestOk, alert: false });
    expect(tg.edits).toEqual([]);
  });

  it('«Сообщения простым текстом»: без таблиц, кнопки остаются; запись в историю; без Telegram — 409', async () => {
    const cookie = await signIn(app, 'owner-a', PASSWORD);
    const chief = await signIn(app, 'chief-a', PASSWORD);
    const none = await apiRequest(app, 'PUT', '/api/telegram/plain', chief, { plain: true });
    expect(none.status).toBe(409);
    expect((await apiRequest(app, 'PUT', '/api/telegram/plain', cookie, {})).status).toBe(400);
    expect(
      (await apiRequest(app, 'PUT', '/api/telegram/plain', undefined, { plain: true })).status,
    ).toBe(401);

    const meOf = async () =>
      MeResponse.parse(await (await app.request('/api/auth/me', { headers: { cookie } })).json());
    expect((await meOf()).telegram?.plain).toBe(false);
    expect(
      (await apiRequest(app, 'PUT', '/api/telegram/plain', cookie, { plain: true })).status,
    ).toBe(200);
    expect((await meOf()).telegram?.plain).toBe(true);
    const [history] = await t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, a.ownerUserId)))
      .orderBy(desc(auditLog.id));
    expect(history).toMatchObject({
      orgId: a.orgId,
      actorUserId: a.ownerUserId,
      changes: [{ field: 'telegramPlain', from: false, to: true }],
      via: null,
    });

    await send(a.ownerUserId, 6001);
    expect(tg.sent.at(-1)!.options.rich).toBeUndefined();
    expect(tg.sent.at(-1)!.text).toBe('Сегодня срок\nНДС за октябрь\n• ОсОО «Ромашка» — НДС');
    expect(tg.sent.at(-1)!.options.keyboard).toHaveLength(2);

    expect(
      (await apiRequest(app, 'PUT', '/api/telegram/plain', cookie, { plain: false })).status,
    ).toBe(200);
    await send(a.ownerUserId, 6001);
    expect(tg.sent.at(-1)!.options.rich).toContain('<table');
  });

  it('нажатие: действие от имени получателя в его организации, история «через Telegram», кнопка гаснет, повтор — «Кнопка устарела»', async () => {
    const id = await send(a.ownerUserId, 6001);
    expect((await press('mark:r1', 6001, id)).status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.user).toMatchObject({
      userId: a.ownerUserId,
      orgId: a.orgId,
      login: 'owner-a',
      isPlatformAdmin: false,
    });
    expect(seen[0]!.arg).toBe('r1');
    // Транзакция действия видит только свою организацию (RLS) и права нажавшего.
    expect(lastAnswer()).toMatchObject({
      text: 'Готово: r1; организаций видно: 1; владелец: true',
      alert: false,
    });
    const [history] = await t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, a.ownerUserId)))
      .orderBy(desc(auditLog.id));
    expect(history).toMatchObject({
      orgId: a.orgId,
      actorUserId: a.ownerUserId,
      changes: [{ field: 'botMark', to: 'r1' }],
      via: 'telegram',
    });
    // Нажатая кнопка неактивна с новой подписью, «Открыть» погашена действием, остальные — как были.
    expect(tg.edits).toEqual([
      {
        chatId: 6001,
        messageId: id,
        keyboard: [
          [
            { text: 'Сдан ✓', data: 'off', disabled: true },
            { text: 'Открыть', data: 'off', disabled: true },
          ],
          [
            { text: 'Сбой', data: 'boom' },
            { text: 'Устарело', data: 'stale' },
            { text: 'Файл', data: 'ask' },
          ],
        ],
      },
    ]);
    // Повторное нажатие (и нажатие погашенной кнопки) действие не выполняет.
    for (const data of ['mark:r1', 'look:r1', 'off']) {
      await press(data, 6001, id);
      expect(lastAnswer()).toMatchObject({ text: TPL.tgActStale, alert: true });
    }
    expect(seen).toHaveLength(1);
  });

  it('нажатие не принимается: чужой чат, чужое сообщение, кнопки нет в сообщении, группа, нажал не хозяин чата', async () => {
    const cookieB = await signIn(app, 'owner-b', PASSWORD);
    await linkTelegram(app, cookieB, 6002);
    const id = await send(a.ownerUserId, 6001);
    const idB = await send(b.ownerUserId, 6002);
    // Номер сообщения чужого чата: в своём чате такого сообщения нет.
    await press('mark:r1', 6002, id === idB ? id + 1000 : id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActStale, alert: true });
    // Данные подделаны: такой кнопки в сообщении не было (другая запись, другое действие).
    for (const data of ['mark:r2', 'mark', 'test', 'delete:r1', 'mark:r1:x', 'x'.repeat(64)]) {
      await press(data, 6001, id);
      expect(lastAnswer()).toMatchObject({ text: TPL.tgActStale, alert: true });
    }
    // Группа и нажатие не хозяином чата — без ответа и без действия.
    await press('mark:r1', 6001, id, { chatType: 'group' });
    expect(lastAnswer()).toMatchObject({ text: undefined });
    await press('mark:r1', 6001, id, { fromId: 6002 });
    expect(lastAnswer()).toMatchObject({ text: undefined });
    expect(seen).toHaveLength(0);
    // Сообщение организации Б действует только от имени её пользователя.
    await press('mark:r1', 6002, idB);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.user).toMatchObject({ userId: b.ownerUserId, orgId: b.orgId });
    expect(lastAnswer()?.text).toContain('организаций видно: 1');
  });

  it('«Действия из Telegram»: выключает только владелец; выключено — действие, меняющее данные, не выполняется', async () => {
    const owner = await signIn(app, 'owner-a', PASSWORD);
    const chief = await signIn(app, 'chief-a', PASSWORD);
    expect((await policyOf(owner)).telegramActions).toBe(true);
    const denied = await setActions(chief, false);
    expect(denied.status).toBe(403);
    expect(await errorCode(denied)).toBe('forbidden');
    expect((await policyOf(owner)).telegramActions).toBe(true);
    expect((await setActions(owner, false)).status).toBe(200);
    expect((await policyOf(chief)).telegramActions).toBe(false);
    // Переключатель — в истории учётной политики: было включено, стало выключено, кто.
    const [history] = await t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'org_settings'), eq(auditLog.entityId, a.orgId)))
      .orderBy(desc(auditLog.id));
    expect(history).toMatchObject({
      actorUserId: a.ownerUserId,
      changes: [{ field: 'telegramActions', from: true, to: false }],
      via: null,
    });

    const id = await send(a.ownerUserId, 6001);
    await press('mark:r1', 6001, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActOff, alert: true });
    expect(seen).toHaveLength(0);
    expect(tg.edits).toEqual([]);
    // Действие, которое данные не меняет, работает и при выключенном переключателе.
    await press('look:r1', 6001, id);
    expect(lastAnswer()).toMatchObject({ text: 'Смотрю r1', alert: true });

    expect((await setActions(owner, true)).status).toBe(200);
    await press('mark:r1', 6001, id);
    expect(seen).toHaveLength(1);
  });

  it('сбой действия — «Не получилось…», запись изменилась — «Кнопка устарела»; новое сообщение после нажатия', async () => {
    const id = await send(a.ownerUserId, 6001);
    await press('boom', 6001, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActFailed, alert: true });
    await press('stale', 6001, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActStale, alert: true });
    const from = tg.sent.length;
    await press('ask', 6001, id);
    expect(lastAnswer()).toMatchObject({ text: undefined });
    expect(tg.sent.slice(from)).toEqual([
      { chatId: 6001, text: 'Пришлите файл отчёта.', options: {} },
    ]);
    expect(tg.edits).toEqual([]);
  });

  it('очередь: сообщение с кнопками уходит с клавиатурой, номер сообщения запоминается, нажатие работает', async () => {
    const now = deps.clock.now();
    const ids = await withOrgContext(deps.db, { orgId: a.orgId, userId: a.ownerUserId }, (tx) =>
      queueEvents(
        tx,
        [
          {
            userId: a.ownerUserId,
            chatId: 6001,
            kind: 'bot_test',
            text: 'Сегодня срок\nНДС за октябрь\n• ОсОО «Ромашка» — НДС',
            message,
          },
        ],
        now,
      ),
    );
    const from = tg.sent.length;
    await flushEvents(deps, a.orgId, ids);
    expect(tg.sent.slice(from)).toHaveLength(1);
    expect(tg.sent.at(-1)!.options.rich).toContain('<table');
    expect(tg.sent.at(-1)!.options.keyboard?.[0]).toEqual([
      { text: 'Сдан', data: 'mark:r1' },
      { text: 'Открыть', data: 'look:r1' },
    ]);
    const [row] = await t.admin.db
      .select()
      .from(telegramOutbox)
      .where(eq(telegramOutbox.id, ids[0]!));
    expect(row).toMatchObject({ status: 'sent', messageId: tg.messageIds.at(-1) });
    await press('look:r1', 6001, tg.messageIds.at(-1)!);
    expect(lastAnswer()).toMatchObject({ text: 'Смотрю r1' });
  });

  it('заблокированный сотрудник и отвязанный Telegram: «Нет права», «Этот Telegram не привязан»', async () => {
    const chief = await signIn(app, 'chief-a', PASSWORD);
    await linkTelegram(app, chief, 6003);
    const id = await send(accA, 6003);
    await t.admin.db.update(employees).set({ active: false }).where(eq(employees.userId, accA));
    await press('look:r1', 6003, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActNoRight, alert: true });
    await t.admin.db.update(employees).set({ active: true }).where(eq(employees.userId, accA));
    await press('look:r1', 6003, id);
    expect(lastAnswer()).toMatchObject({ text: 'Смотрю r1' });

    const again = await signIn(app, 'chief-a', PASSWORD);
    expect((await apiRequest(app, 'DELETE', '/api/telegram/link', again)).status).toBe(200);
    await press('look:r1', 6003, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActNoLink, alert: true });
  });

  it('временный пароль и привязка другого Telegram без кода после сброса пароля: кнопки не действуют', async () => {
    const id = await send(a.ownerUserId, 6001);
    const owner = eq(users.id, a.ownerUserId);
    await t.admin.db.update(users).set({ mustChangePassword: true }).where(owner);
    for (const data of ['look:r1', 'mark:r1']) {
      await press(data, 6001, id);
      expect(lastAnswer()).toMatchObject({ text: TPL.tgActNoRight, alert: true });
    }
    await t.admin.db.update(users).set({ mustChangePassword: false }).where(owner);
    await t.admin.db.insert(telegramLinkGuards).values({
      userId: a.ownerUserId,
      orgId: a.orgId,
      freeUntil: new Date(Date.now() + 3_600_000),
    });
    await press('mark:r1', 6001, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActNoRight, alert: true });
    expect(seen).toHaveLength(0);
    expect(tg.edits).toEqual([]);
    await t.admin.db.delete(telegramLinkGuards).where(eq(telegramLinkGuards.userId, a.ownerUserId));
    await press('look:r1', 6001, id);
    expect(lastAnswer()).toMatchObject({ text: 'Смотрю r1' });
  });

  it('право действия проверяет ядро: без права — «Нет права», обработчик не вызывается', async () => {
    await t.admin.db.insert(telegramLinks).values({ userId: accA, orgId: a.orgId, chatId: 6004 });
    const id = await send(accA, 6004, extra);
    await press('perm', 6004, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActNoRight, alert: true });
    expect(seen).toHaveLength(0);
    // Действие без права тот же сотрудник выполняет.
    await press('who', 6004, id);
    expect(lastAnswer()).toMatchObject({ text: 'сотрудник; администратор платформы: false' });
    await t.admin.db.delete(telegramLinks).where(eq(telegramLinks.userId, accA));

    const idOwner = await send(a.ownerUserId, 6001, extra);
    await press('perm', 6001, idOwner);
    expect(lastAnswer()).toMatchObject({ text: 'Право есть', alert: false });
    expect(seen).toHaveLength(1);
  });

  it('администратор платформы: нажатие без организации; действие с правом сотрудника — «Нет права»', async () => {
    await t.admin.db.insert(telegramLinks).values({ userId: adminId, orgId: null, chatId: 6009 });
    const id = await send(adminId, 6009, extra);
    // «Действия из Telegram» организаций администратора платформы не касаются.
    await press('who', 6009, id);
    expect(lastAnswer()).toMatchObject({
      text: 'не сотрудник; администратор платформы: true',
      alert: false,
    });
    await press('perm', 6009, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActNoRight, alert: true });
    expect(seen).toHaveLength(0);
    // Заблокированный администратор платформы — «Нет права».
    await t.admin.db.update(users).set({ blocked: true }).where(eq(users.id, adminId));
    await press('who', 6009, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActNoRight, alert: true });
    await t.admin.db.update(users).set({ blocked: false }).where(eq(users.id, adminId));
  });

  it('два нажатия одной кнопки сразу: действие выполняется один раз, второе — «Кнопка устарела»', async () => {
    const id = await send(a.ownerUserId, 6001);
    const from = tg.answers.length;
    await Promise.all([press('mark:r1', 6001, id), press('mark:r1', 6001, id)]);
    expect(seen).toHaveLength(1);
    const texts = tg.answers
      .slice(from)
      .map((x) => x.text)
      .sort();
    expect(texts).toEqual(
      [TPL.tgActStale, 'Готово: r1; организаций видно: 1; владелец: true'].sort(),
    );
    expect(tg.edits).toHaveLength(1);
    const marks = await t.admin.db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'user'), eq(auditLog.via, 'telegram')));
    const before = marks.length;
    await press('mark:r1', 6001, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActStale, alert: true });
    const after = await t.admin.db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'user'), eq(auditLog.via, 'telegram')));
    expect(after).toHaveLength(before);
  });

  it('сбой действия откатывает всё нажатие: записи в истории нет, кнопка остаётся активной', async () => {
    const failing: Record<string, BotAction> = {
      ...actions,
      mark: {
        change: true,
        run: async (ctx) => {
          await ctx.asUser((tx) =>
            writeHistory(tx, {
              entity: 'user',
              entityId: ctx.user.userId,
              action: 'update',
              changes: [{ field: 'botRollback', to: ctx.arg }],
            }),
          );
          throw new Error('сбой после записи');
        },
      },
    };
    deps = createTestDeps({ db: t.app.db, telegram: tg, botActions: failing });
    app = createApp(deps);
    const id = await send(a.ownerUserId, 6001);
    await press('mark:r1', 6001, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActFailed, alert: true });
    expect(tg.edits).toEqual([]);
    const rows = await t.admin.db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, a.ownerUserId)));
    expect(rows.flatMap((r) => r.changes).some((c) => c.field === 'botRollback')).toBe(false);
    // Кнопка не погашена: то же нажатие с исправным действием выполняется.
    deps = createTestDeps({ db: t.app.db, telegram: tg, botActions: actions });
    app = createApp(deps);
    await press('mark:r1', 6001, id);
    expect(seen).toHaveLength(1);
  });

  it('заблокированная организация, заблокированный пользователь — «Нет права»; Telegram привязан заново к другому чату — «не привязан»', async () => {
    const id = await send(b.ownerUserId, 6002);
    const org = eq(organizations.id, b.orgId);
    await t.admin.db.update(organizations).set({ status: 'blocked' }).where(org);
    await press('look:r1', 6002, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActNoRight, alert: true });
    await t.admin.db.update(organizations).set({ status: 'active' }).where(org);
    const user = eq(users.id, b.ownerUserId);
    await t.admin.db.update(users).set({ blocked: true }).where(user);
    await press('look:r1', 6002, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActNoRight, alert: true });
    await t.admin.db.update(users).set({ blocked: false }).where(user);
    await press('look:r1', 6002, id);
    expect(lastAnswer()).toMatchObject({ text: 'Смотрю r1' });

    // Привязан другой чат: из прежнего кнопки не действуют, а в новом такого сообщения нет.
    const link = eq(telegramLinks.userId, b.ownerUserId);
    await t.admin.db.update(telegramLinks).set({ chatId: 6012 }).where(link);
    await press('look:r1', 6002, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActNoLink, alert: true });
    await press('look:r1', 6012, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActStale, alert: true });
    await t.admin.db.update(telegramLinks).set({ chatId: 6002 }).where(link);
    expect(seen).toHaveLength(0);
  });

  it('вид сообщения: таблицы платформы выключены — простой текст с кнопками (сразу и из очереди); заголовок без таблиц — вид с разметкой', async () => {
    const setRich = (rich: boolean) =>
      withUserContext(t.app.db, adminId, (tx) => adminSetTelegramBotRich(tx, rich));
    expect(await setRich(false)).toBe(true);
    try {
      const id = await send(a.ownerUserId, 6001);
      expect(tg.sent.at(-1)!.options.rich).toBeUndefined();
      expect(tg.sent.at(-1)!.text).toBe('Сегодня срок\nНДС за октябрь\n• ОсОО «Ромашка» — НДС');
      expect(tg.sent.at(-1)!.options.keyboard).toHaveLength(2);
      await press('look:r1', 6001, id);
      expect(lastAnswer()).toMatchObject({ text: 'Смотрю r1' });

      const now = deps.clock.now();
      const ids = await withOrgContext(deps.db, { orgId: a.orgId, userId: a.ownerUserId }, (tx) =>
        queueEvents(
          tx,
          [
            {
              userId: a.ownerUserId,
              chatId: 6001,
              kind: 'bot_test',
              text: 'Сегодня срок',
              message,
            },
          ],
          now,
        ),
      );
      const from = tg.sent.length;
      await flushEvents(deps, a.orgId, ids);
      expect(tg.sent.slice(from)).toHaveLength(1);
      expect(tg.sent.at(-1)!.options.rich).toBeUndefined();
      expect(tg.sent.at(-1)!.options.keyboard).toHaveLength(2);
    } finally {
      await setRich(true);
    }
    // Заголовок или подзаголовок без таблиц — тоже вид с разметкой; один текст — обычное сообщение.
    await send(a.ownerUserId, 6001, { heading: 'Заголовок', text: 'Текст' });
    expect(tg.sent.at(-1)!.options.rich).toContain('Заголовок');
    await send(a.ownerUserId, 6001, { text: 'Просто текст' });
    expect(tg.sent.at(-1)!.options.rich).toBeUndefined();
  });

  it('«Проверить бота» — не чаще 10 раз в час: дальше 429', async () => {
    deps = createTestDeps({ db: t.app.db, telegram: tg });
    app = createApp(deps);
    const cookie = await signIn(app, 'owner-b', PASSWORD);
    for (let i = 0; i < 10; i += 1) {
      expect((await apiRequest(app, 'POST', '/api/telegram/test', cookie)).status).toBe(200);
    }
    const from = tg.sent.length;
    const res = await apiRequest(app, 'POST', '/api/telegram/test', cookie);
    expect(res.status).toBe(429);
    expect(await errorCode(res)).toBe('bot_test_limit');
    expect(tg.sent).toHaveLength(from);
  });

  it('нажатия, меняющие данные, — не чаще предела с одного чата: дальше отказ, действие без изменений отвечает', async () => {
    await t.admin.db.delete(rateLimits).where(eq(rateLimits.kind, BOT_PRESS_RATE_LIMIT.kind));
    await t.admin.db
      .insert(telegramLinks)
      .values({ userId: adminId, orgId: null, chatId: 6009 })
      .onConflictDoNothing();
    const id = await send(adminId, 6009, extra);
    for (let i = 0; i < BOT_PRESS_RATE_LIMIT.max; i += 1) await press('who', 6009, id);
    expect(tg.answers).toHaveLength(BOT_PRESS_RATE_LIMIT.max);
    expect(new Set(tg.answers.map((x) => x.text))).toEqual(
      new Set(['не сотрудник; администратор платформы: true']),
    );
    await press('who', 6009, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActFailed, alert: true });
    // Действие, которое данные не меняет, в предел не входит.
    await press('perm', 6009, id);
    expect(lastAnswer()).toMatchObject({ text: TPL.tgActNoRight, alert: true });
    await t.admin.db.delete(rateLimits).where(eq(rateLimits.kind, BOT_PRESS_RATE_LIMIT.kind));
  });

  it('«Проверить бота»: Telegram не принял сообщение — 502 со своим кодом, не кодом входа в Админку', async () => {
    deps = createTestDeps({ db: t.app.db, telegram: tg });
    app = createApp(deps);
    const cookie = await signIn(app, 'owner-a', PASSWORD);
    tg.failNext({
      ok: false,
      errorCode: 403,
      description: 'Forbidden: bot was blocked by the user',
      permanent: true,
    });
    const res = await apiRequest(app, 'POST', '/api/telegram/test', cookie);
    expect(res.status).toBe(502);
    expect(await errorCode(res)).toBe('bot_test_failed');
  });
});
