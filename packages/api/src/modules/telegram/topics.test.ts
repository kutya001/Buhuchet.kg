import { createFakeTelegram, fixedClock, type FakeTelegram } from '@buhuchet/adapters';
import { enqueueTelegram, schema, withOrgContext } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { BOT_CARD_ACTION, type BotMessage } from '@buhuchet/domain';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  linkTelegram,
  sendToBot,
  signIn,
  telegramPress,
  telegramUpdate,
  TEST_PASSWORD,
} from '../../testing';
import { sendBotMessage, sendNow } from './bot';
import { telegramSendJob } from './outbox';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const CHAT = { owner: 8100, shared: 8200 } as const;
const noPause = async () => {};

// Темы в чате с ботом (поток Т, задача Т7; пакет заказчика 13.11.2026, идея 6; прототип v104
// modules/tg-topics.js; docs/decisions.md п. Т-7).
describe.skipIf(!databaseAvailable())('Темы в чате с ботом (Т7)', () => {
  let f: Fixture;
  let tg: FakeTelegram;
  let deps: ApiDeps;
  let app: ReturnType<typeof createApp>;
  let admin = '';

  const sent = (chatId: number) => tg.sent.filter((m) => m.chatId === chatId);
  const last = (chatId: number) => sent(chatId).at(-1)!;
  const topicsOf = (chatId: number) =>
    tg.topics.filter((t) => t.chatId === chatId).map((t) => [t.name, t.threadId]);
  const rows = (chatId: number) =>
    f.t.admin.db
      .select({ key: schema.telegramTopics.key, threadId: schema.telegramTopics.threadId })
      .from(schema.telegramTopics)
      .where(eq(schema.telegramTopics.chatId, chatId))
      .orderBy(asc(schema.telegramTopics.key));
  const switchTopics = async (topics: boolean) => {
    const res = await apiRequest(app, 'PUT', '/api/admin/telegram/bot/topics', admin, { topics });
    expect(res.status).toBe(200);
  };
  const message = (text: string): BotMessage => ({ text });
  const toOwner = (kind: Parameters<typeof sendBotMessage>[3], text: string, userId?: string) =>
    sendBotMessage(
      deps,
      { userId: userId ?? f.a.ownerUserId, chatId: CHAT.owner },
      message(text),
      kind,
      't',
    );

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    tg = createFakeTelegram();
    deps = createTestDeps({
      db: f.t.app.db,
      telegram: tg,
      clock: fixedClock('2026-11-13T03:00:00Z'),
    });
    app = createApp(deps);
    for (const orgId of [f.a.orgId, f.b.orgId]) {
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: { telegram: true } })
        .where(eq(schema.orgSettings.orgId, orgId));
    }
    await linkTelegram(app, await signIn(app, 'owner-a', TEST_PASSWORD), CHAT.owner);
    // Один Telegram — учётные записи двух организаций.
    await linkTelegram(app, await signIn(app, 'chief-a', TEST_PASSWORD), CHAT.shared);
    await linkTelegram(app, await signIn(app, 'owner-b', TEST_PASSWORD), CHAT.shared);
    admin = await signIn(app, 'platform-admin', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('переключатель выключен (по умолчанию) — всё без тем, как раньше', async () => {
    expect(await toOwner('task_new', 'Новая задача')).toBe(true);
    expect(last(CHAT.owner).options.threadId).toBeUndefined();
    expect(tg.topics).toEqual([]);
    expect(await rows(CHAT.owner)).toEqual([]);
  });

  it('включён — тема своего вида создаётся при первом сообщении и дальше та же; «Общее» — без темы', async () => {
    await switchTopics(true);
    expect(await toOwner('task_new', 'Задача 1')).toBe(true);
    expect(topicsOf(CHAT.owner)).toEqual([['Задачи', 1000]]);
    expect(last(CHAT.owner).options.threadId).toBe(1000);
    expect(await toOwner('task_done', 'Задача 2')).toBe(true);
    expect(last(CHAT.owner).options.threadId).toBe(1000);
    // Код и «Пароль изменён» — «Безопасность»; ответ на команду и проверка бота — без темы.
    await sendNow(
      deps,
      CHAT.owner,
      'Пароль изменён',
      't',
      {},
      {
        userId: f.a.ownerUserId,
        kind: 'pass_changed',
      },
    );
    expect(last(CHAT.owner).options.threadId).toBe(1001);
    await sendNow(deps, CHAT.owner, 'Проверка', 't');
    expect(last(CHAT.owner).options.threadId).toBeUndefined();
    expect(await toOwner('bot_cmd', 'Ответ')).toBe(true);
    expect(last(CHAT.owner).options.threadId).toBeUndefined();
    // Очередь: напоминание — «Отчёты».
    await withOrgContext(f.t.app.db, { orgId: f.a.orgId, kind: 'job' }, (tx) =>
      enqueueTelegram(
        tx,
        [{ userId: f.a.ownerUserId, chatId: CHAT.owner, kind: 'reminders', text: 'Сроки' }],
        deps.clock.now(),
      ),
    );
    await telegramSendJob(noPause).run(deps, deps.clock.now());
    expect(last(CHAT.owner)).toMatchObject({ text: 'Сроки', options: { threadId: 1002 } });
    expect(topicsOf(CHAT.owner)).toEqual([
      ['Задачи', 1000],
      ['Безопасность', 1001],
      ['Отчёты', 1002],
    ]);
    expect(await rows(CHAT.owner)).toEqual([
      { key: 'rep', threadId: 1002 },
      { key: 'sec', threadId: 1001 },
      { key: 'task', threadId: 1000 },
    ]);
  });

  it('человек удалил тему — бот создаёт её заново и отправляет снова', async () => {
    tg.deleteTopic(1000);
    const before = sent(CHAT.owner).length;
    expect(await toOwner('task_new', 'После удаления')).toBe(true);
    expect(topicsOf(CHAT.owner).at(-1)).toEqual(['Задачи', 1003]);
    // Одна попытка в удалённую тему не записывается подставным ботом — дошло одно сообщение.
    expect(sent(CHAT.owner).slice(before)).toMatchObject([
      { text: 'После удаления', options: { threadId: 1003 } },
    ]);
    expect(await rows(CHAT.owner)).toContainEqual({ key: 'task', threadId: 1003 });
  });

  it('темы не включены в @BotFather — сообщение уходит без темы', async () => {
    tg.topicsOn = false;
    await f.t.admin.db
      .delete(schema.telegramTopics)
      .where(eq(schema.telegramTopics.chatId, CHAT.owner));
    expect(await toOwner('task_new', 'Без тем')).toBe(true);
    expect(last(CHAT.owner)).toMatchObject({ text: 'Без тем' });
    expect(last(CHAT.owner).options.threadId).toBeUndefined();
    expect(await rows(CHAT.owner)).toEqual([]);
    tg.topicsOn = true;
  });

  it('команда в теме — ответ в ту же тему', async () => {
    const before = sent(CHAT.owner).length;
    const res = await sendToBot(app, telegramUpdate('/today', CHAT.owner, { threadId: 1003 }));
    expect(res.status).toBe(200);
    const answers = sent(CHAT.owner).slice(before);
    expect(answers.length).toBeGreaterThan(0);
    for (const m of answers) expect(m.options.threadId).toBe(1003);
    // Без темы — ответ без темы.
    const again = sent(CHAT.owner).length;
    await sendToBot(app, telegramUpdate('/today', CHAT.owner));
    for (const m of sent(CHAT.owner).slice(again)) expect(m.options.threadId).toBeUndefined();
  });

  it('нажатие кнопки в теме — ответ в ту же тему', async () => {
    const [cp] = await f.t.admin.db
      .insert(schema.contractors)
      .values({
        orgId: f.a.orgId,
        name: 'ОсОО «Темы Трейд»',
        inn: '03744097401999',
        phone: '+996505890076',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        startDate: '2026-07-01',
        feeDay: 15,
        paysTo: 'org',
      })
      .returning({ id: schema.contractors.id });
    const card: BotMessage = {
      text: 'Найдено контрагентов: 2. Выберите нужного.',
      buttons: [[{ text: 'Контрагент', action: BOT_CARD_ACTION, arg: cp!.id }]],
    };
    expect(
      await sendBotMessage(
        deps,
        { userId: f.a.ownerUserId, chatId: CHAT.owner },
        card,
        'bot_cmd',
        't',
      ),
    ).toBe(true);
    const messageId = tg.messageIds.at(-1)!;
    const before = sent(CHAT.owner).length;
    const res = await sendToBot(
      app,
      telegramPress(`${BOT_CARD_ACTION}:${cp!.id}`, CHAT.owner, messageId, { threadId: 1003 }),
    );
    expect(res.status).toBe(200);
    const answers = sent(CHAT.owner).slice(before);
    expect(answers).toHaveLength(1);
    expect(answers[0]!.text).toContain('ОсОО «Темы Трейд»');
    expect(answers[0]!.options.threadId).toBe(1003);
  });

  it('чат нескольких организаций — отчёты и задачи в темы организаций, «Безопасность» общая; команда в теме организации — по её учётной записи', async () => {
    const chief = f.people['chief-a']!.userId;
    const to = (userId: string, kind: Parameters<typeof sendBotMessage>[3], text: string) =>
      sendBotMessage(deps, { userId, chatId: CHAT.shared }, message(text), kind, 't');
    expect(await to(chief, 'task_new', 'Задача А')).toBe(true);
    expect(await to(f.b.ownerUserId, 'task_new', 'Задача Б')).toBe(true);
    expect(await to(f.b.ownerUserId, 'pass_changed', 'Пароль Б')).toBe(true);
    expect(await to(chief, 'pass_changed', 'Пароль А')).toBe(true);
    const names = tg.topics.filter((t) => t.chatId === CHAT.shared).map((t) => t.name);
    expect(names).toEqual(['Организация А', 'Организация Б', 'Безопасность']);
    const threads = sent(CHAT.shared).map((m) => [m.text, m.options.threadId]);
    const [a, b, sec] = tg.topics.filter((t) => t.chatId === CHAT.shared).map((t) => t.threadId);
    expect(threads).toEqual(
      expect.arrayContaining([
        ['Задача А', a],
        ['Задача Б', b],
        ['Пароль Б', sec],
        ['Пароль А', sec],
      ]),
    );
    expect((await rows(CHAT.shared)).map((r) => r.key).sort()).toEqual(
      [`org:${f.a.orgId}`, `org:${f.b.orgId}`, 'sec'].sort(),
    );
    // Очередь организации Б — в тему организации Б.
    await withOrgContext(f.t.app.db, { orgId: f.b.orgId, kind: 'job' }, (tx) =>
      enqueueTelegram(
        tx,
        [{ userId: f.b.ownerUserId, chatId: CHAT.shared, kind: 'reminders', text: 'Сроки Б' }],
        deps.clock.now(),
      ),
    );
    await telegramSendJob(noPause).run(deps, deps.clock.now());
    expect(last(CHAT.shared)).toMatchObject({ text: 'Сроки Б', options: { threadId: b } });

    // Команда: без темы — ответ по обеим учётным записям, в теме организации Б — только по её.
    const count = async (threadId?: number) => {
      const before = sent(CHAT.shared).length;
      await sendToBot(app, telegramUpdate('/today', CHAT.shared, threadId ? { threadId } : {}));
      return sent(CHAT.shared).slice(before);
    };
    expect(await count()).toHaveLength(2);
    const inB = await count(b);
    expect(inB).toHaveLength(1);
    expect(inB[0]!.options.threadId).toBe(b);
    expect(inB[0]!.text).not.toContain('Организация А');
  });

  it('выключили — снова без тем', async () => {
    await switchTopics(false);
    expect(await toOwner('task_new', 'Снова без тем')).toBe(true);
    expect(last(CHAT.owner).options.threadId).toBeUndefined();
  });
});
