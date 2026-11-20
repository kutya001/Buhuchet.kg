import {
  createFakeTelegram,
  fixedClock,
  type FakeTelegram,
  type FixedClock,
} from '@buhuchet/adapters';
import { createManualReport, schema, withOrgContext } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { reportBotMessage, UI_TEXTS } from '@buhuchet/domain';
import { ApiError, MeResponse } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import type { ApiDeps } from './deps';
import { bellDayJob } from './modules/telegram/bell-day';
import { sendBotMessage } from './modules/telegram/bot';
import { telegramRemindersJob } from './modules/telegram/reminders';
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
} from './testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const CLOSED = UI_TEXTS['subs.tg.closed'].ru;
const CHAT = { acc: 7302, owner: 7300 } as const;
const SITE = 'https://stand.example';
const noPause = async () => {};

// Доступ организации закрыт по подписке (доработки 20.11.2026, блок 4, пункты 4–5; прототип
// core/login.js `LG_T.sub`, org-sub.js `subLockMods`): со следующего дня после «Оплачено до».
// Понедельник, 19.10.2026, 10:00 по Бишкеку; у организации А «Оплачено до» — 18.10.
describe.skipIf(!databaseAvailable())('доступ закрыт по подписке: вход, сеанс, бот', () => {
  let f: Fixture;
  let tg: FakeTelegram;
  let clock: FixedClock;
  let deps: ApiDeps;
  let app: ReturnType<typeof createApp>;
  let accCookie = '';
  let ownerCookie = '';
  let report = '';

  const paidUntil = (day: string) =>
    f.t.admin.db
      .update(schema.orgSubscriptions)
      .set({ paidUntil: day })
      .where(eq(schema.orgSubscriptions.orgId, f.a.orgId));
  const login = (name: string, password = TEST_PASSWORD) =>
    apiRequest(app, 'POST', '/api/auth/login', undefined, { login: name, password });
  const errorOf = async (res: Response) => ApiError.parse(await res.json()).error;
  const sentTo = (chatId: number) => tg.sent.filter((m) => m.chatId === chatId);

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    tg = createFakeTelegram();
    clock = fixedClock('2026-10-19T04:00:00Z');
    deps = createTestDeps({ db: f.t.app.db, telegram: tg, clock });
    app = createApp(deps);
    await f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: { telegram: true }, remindDays: [3, 2] })
      .where(eq(schema.orgSettings.orgId, f.a.orgId));
    accCookie = await signIn(app, 'acc-a', TEST_PASSWORD);
    ownerCookie = await signIn(app, 'owner-a', TEST_PASSWORD);
    await linkTelegram(app, accCookie, CHAT.acc);
    await linkTelegram(app, ownerCookie, CHAT.owner);
    const connect = await apiRequest(app, 'POST', '/api/org-report-types/connect', ownerCookie, {
      connect: ['t1m'],
      disconnect: [],
    });
    expect(connect.status, await connect.clone().text()).toBe(200);
    const [cp] = await f.t.admin.db
      .insert(schema.contractors)
      .values({
        orgId: f.a.orgId,
        name: 'ОсОО «Подписка»',
        inn: '03744097401859',
        phone: '+996505890079',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        startDate: '2026-01-15',
        responsibleEmployeeId: f.people['acc-a']!.employeeId,
      })
      .returning({ id: schema.contractors.id });
    report = (
      await withOrgContext(f.t.app.db, { orgId: f.a.orgId, userId: f.a.ownerUserId }, (tx) =>
        createManualReport(
          tx,
          {
            contractorId: cp!.id,
            reportTypeCode: 't1m',
            month: '2026-09-01',
            eventDate: null,
            due: '2026-10-22',
            reasonCode: 'ПРЧ-001',
            reasonName: 'Продление от госоргана',
          },
          { today: clock.today(), scope: undefined },
        ),
      )
    ).id;
    // Сообщение с кнопками, пока доступ открыт: его кнопку нажмут, когда доступ закроется.
    expect(
      await sendBotMessage(
        deps,
        { userId: f.people['acc-a']!.userId, chatId: CHAT.acc },
        reportBotMessage(
          { id: report, name: '1-Т', contractor: 'ОсОО «Подписка»', todo: true },
          'срок 22.10',
          { work: 'В работе', done: 'Сдан', open: 'Открыть' },
          null,
        ),
        'reminders',
        't',
      ),
    ).toBe(true);
    await paidUntil('2026-10-18');
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('сотрудник узнаёт о закрытии только после верного пароля, как о блокировке', async () => {
    const wrong = await login('acc-a', 'Неверный-пароль-1');
    expect(wrong.status).toBe(401);
    expect((await errorOf(wrong)).code).toBe('invalid_credentials');
    const right = await login('acc-a');
    expect(right.status).toBe(403);
    expect(await errorOf(right)).toMatchObject({
      code: 'sub_closed',
      message:
        'Доступ закрыт: подписка организации не оплачена. Обратитесь к владельцу организации.',
    });
    expect(right.headers.get('set-cookie') ?? '').not.toContain('=ey');
  });

  it('открытый сеанс сотрудника закрывается при первом запросе', async () => {
    const first = await apiRequest(app, 'GET', '/api/auth/me', accCookie);
    expect(first.status).toBe(403);
    expect((await errorOf(first)).code).toBe('sub_closed');
    expect((await apiRequest(app, 'GET', '/api/auth/me', accCookie)).status).toBe(401);
  });

  it('владелец входит: в меню только «Моя организация», остальное — 403, «Подписка» открыта', async () => {
    const res = await login('owner-a');
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    const me = MeResponse.parse(
      await (await apiRequest(app, 'GET', '/api/auth/me', cookie)).json(),
    );
    expect(me.subClosed).toBe(true);
    expect(me.modules).toEqual(['org']);
    const contractors = await apiRequest(app, 'GET', '/api/contractors', cookie);
    expect(contractors.status).toBe(403);
    expect(await errorOf(contractors)).toMatchObject({
      code: 'sub_closed_owner',
      message:
        'Доступ закрыт: подписка организации не оплачена. Оплатите её в «Моя организация» → «Подписка».',
    });
    expect((await apiRequest(app, 'GET', '/api/org/profile', cookie)).status).toBe(403);
    // Экран «Подписка» и окно оплаты — под /api/org/subscription: слой входа их пропускает.
    for (const path of ['/api/org/subscription', '/api/org/subscription/pay']) {
      const open = await apiRequest(app, 'GET', path, cookie);
      expect(open.status, path).not.toBe(403);
    }
    expect((await apiRequest(app, 'GET', '/api/org/subscriptions', cookie)).status).toBe(403);
    // Сеанс владельца не закрывается.
    expect((await apiRequest(app, 'GET', '/api/auth/me', cookie)).status).toBe(200);
  });

  it('другая организация и администратор платформы — не задеты; демо не закрывается', async () => {
    expect((await login('acc-b')).status).toBe(200);
    const admin = await login('platform-admin');
    expect(admin.status).toBe(200);
    await f.t.admin.db
      .update(schema.organizations)
      .set({ isDemo: true })
      .where(eq(schema.organizations.id, f.a.orgId));
    try {
      expect((await login('acc-a')).status).toBe(200);
    } finally {
      await f.t.admin.db
        .update(schema.organizations)
        .set({ isDemo: false })
        .where(eq(schema.organizations.id, f.a.orgId));
    }
  });

  it('бот: кнопка старого сообщения и команда отвечают «Доступ организации закрыт», данных не меняют', async () => {
    const message = sentTo(CHAT.acc).at(-1)!;
    const id = tg.messageIds[tg.sent.indexOf(message)]!;
    expect((await sendToBot(app, telegramPress(`repWork:${report}`, CHAT.acc, id))).status).toBe(
      200,
    );
    expect(tg.answers.at(-1)).toMatchObject({ text: CLOSED, alert: true });
    const [row] = await f.t.admin.db
      .select({ status: schema.reports.status })
      .from(schema.reports)
      .where(eq(schema.reports.id, report));
    expect(row!.status).not.toBe('in_progress');

    const before = sentTo(CHAT.acc).length;
    expect((await sendToBot(app, telegramUpdate('/today', CHAT.acc))).status).toBe(200);
    const answers = sentTo(CHAT.acc).slice(before);
    expect(answers.map((m) => m.text)).toEqual([CLOSED]);
  });

  it('бот сам не пишет: ни напоминаний, ни строк колокольчика; после оплаты пропущенное не догоняет', async () => {
    tg.sent.length = 0;
    tg.messageIds.length = 0;
    await telegramRemindersJob(SITE, noPause).run(deps, clock.now());
    expect(sentTo(CHAT.acc)).toEqual([]);
    expect(sentTo(CHAT.owner)).toEqual([]);
    // Строки дня колокольчика — в час напоминаний организации (по умолчанию 09:00 по Бишкеку).
    expect(await bellDayJob.run(deps, new Date('2026-10-19T03:00:00Z'))).toBe(0);
    const bell = await f.t.admin.db
      .select()
      .from(schema.bellNotifications)
      .where(
        and(
          eq(schema.bellNotifications.orgId, f.a.orgId),
          eq(schema.bellNotifications.userId, f.people['acc-a']!.userId),
        ),
      );
    expect(bell).toEqual([]);

    // Оплатили в тот же день: сегодняшнее напоминание задним числом не уходит, завтрашнее — уходит.
    await paidUntil('2099-12-31');
    await telegramRemindersJob(SITE, noPause).run(deps, clock.now());
    expect(sentTo(CHAT.acc)).toEqual([]);
    clock.set('2026-10-20T04:00:00Z');
    try {
      await telegramRemindersJob(SITE, noPause).run(deps, clock.now());
      expect(sentTo(CHAT.acc).length).toBeGreaterThan(0);
      expect(await bellDayJob.run(deps, new Date('2026-10-20T03:00:00Z'))).toBeGreaterThan(0);
    } finally {
      clock.set('2026-10-19T04:00:00Z');
      await paidUntil('2026-10-18');
    }
  });

  it('чек, открывший доступ до проверки, держит вход открытым', async () => {
    const id = crypto.randomUUID();
    await f.t.admin.db.insert(schema.subscriptionPayments).values({
      id,
      orgId: f.a.orgId,
      kind: 'renew',
      planId: 'm1',
      months: 1,
      seats: 10,
      amount: 100_000,
      receiptKey: `org/${f.a.orgId}/subs/${id}`,
      receiptName: 'Чек.pdf',
      receiptType: 'application/pdf',
      receiptBytes: 10,
      createdBy: f.a.ownerUserId,
    });
    expect((await login('acc-a')).status).toBe(200);
  });
});
