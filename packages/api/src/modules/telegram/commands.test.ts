import { createFakeTelegram, fixedClock, type FakeTelegram } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  BOT_CARD_ACTION,
  TELEGRAM_TEMPLATE_DEFAULTS,
  UI_TEXTS,
  type BotMessage,
} from '@buhuchet/domain';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import { telegramWebhookJob } from '../../jobs/registry';
import {
  createStaffFixture,
  createTestDeps,
  linkTelegram,
  sendToBot,
  signIn,
  telegramPress,
  telegramUpdate,
  TEST_PASSWORD,
} from '../../testing';
import { sendBotMessage } from './bot';
import { BOT_PRESS_RATE_LIMIT } from './press';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type App = ReturnType<typeof createApp>;

const TPL = TELEGRAM_TEMPLATE_DEFAULTS;
const SITE = 'https://stand.example';
const CHAT = {
  owner: 7600,
  chief: 7601,
  acc: 7602,
  senior: 7603,
  ownerB: 7700,
  admin: 7800,
  nobody: 7900,
  flood: 7901,
} as const;
const MENU = [
  ['Сегодня', 'Неделя'],
  ['Просрочено', 'Найти контрагента'],
];
const CP_ACC = 'ОсОО «Ала-Тоо Трейд»';
const CP_CHIEF = 'ИП Садыков Трейд';
const NO_RIGHT = TPL.tgActNoRight;
const HINT = UI_TEXTS['telegram.cmd.menu_hint'].ru;

// Меню команд бота (поток Т, задача Т5; пакет заказчика 13.11.2026, идея 4; прототип v102
// modules/tg-menu.js). Пятница, 13.11.2026, 09:00 по Бишкеку; неделя — до воскресенья 15.11.
describe.skipIf(!databaseAvailable())(
  'Меню команд бота: «Сегодня», «Неделя», «Просрочено», «Найти контрагента» (Т5)',
  () => {
    let f: Fixture;
    let tg: FakeTelegram;
    let deps: ApiDeps;
    let app: App;
    let cpAcc = '';
    let cpChief = '';
    let cpSenior = '';
    let cpArchived = '';
    let cpB = '';

    const person = (login: string) => f.people[login]!;
    const sent = (chatId: number) =>
      tg.sent.map((m, i) => ({ ...m, id: tg.messageIds[i]! })).filter((m) => m.chatId === chatId);
    const last = (chatId: number) => sent(chatId).at(-1)!;
    const keys = (m: { options: FakeTelegram['sent'][number]['options'] }) =>
      (m.options.keyboard ?? []).flat();
    /** Сообщение человека боту; возвращает, что бот ответил в этот чат. */
    const say = async (chatId: number, text: string, replyTo?: number) => {
      const before = sent(chatId).length;
      const res = await sendToBot(app, telegramUpdate(text, chatId, replyTo ? { replyTo } : {}));
      expect(res.status).toBe(200);
      return sent(chatId).slice(before);
    };
    const press = async (chatId: number, messageId: number, data: string) => {
      const res = await sendToBot(app, telegramPress(data, chatId, messageId));
      expect(res.status).toBe(200);
      return tg.answers.at(-1)!;
    };
    const settings = (features: Record<string, boolean>, orgId = f.a.orgId) =>
      f.t.admin.db
        .update(schema.orgSettings)
        .set({ features })
        .where(eq(schema.orgSettings.orgId, orgId));
    const FEATURES = { telegram: true, tasks: true, fee: true, taxpay: true };
    const user = (login: string, patch: Partial<typeof schema.users.$inferInsert>) =>
      f.t.admin.db.update(schema.users).set(patch).where(eq(schema.users.login, login));
    async function contractor(
      orgId: string,
      name: string,
      inn: string,
      responsible: string | null,
      tariffSom: number | null,
    ) {
      const [row] = await f.t.admin.db
        .insert(schema.contractors)
        .values({
          orgId,
          name,
          inn,
          phone: '+996505890076',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-07-01',
          feeDay: 15,
          paysTo: 'org',
          createdAt: new Date('2026-06-20T10:00:00+06:00'),
          responsibleEmployeeId: responsible,
        })
        .returning({ id: schema.contractors.id });
      if (tariffSom !== null) {
        await f.t.admin.db.insert(schema.contractorTariffs).values({
          orgId,
          contractorId: row!.id,
          amount: tariffSom * 100,
          period: 'M',
          validFrom: '2026-07-01',
        });
      }
      return row!.id;
    }
    /** Отчёт: вид, месяц периода и срок сдачи; остальное — правкой. */
    const report = async (
      contractorId: string,
      reportTypeCode: string,
      month: string,
      due: string,
      patch: Partial<typeof schema.reports.$inferInsert> = {},
      orgId = f.a.orgId,
    ) => {
      const [row] = await f.t.admin.db
        .insert(schema.reports)
        .values({
          orgId,
          contractorId,
          reportTypeCode,
          act: 'both',
          period: 'M',
          periodStart: `${month}-01`,
          eventDate: null,
          dueBase: due,
          dueDate: due,
          ...patch,
        })
        .returning({ id: schema.reports.id });
      return row!.id;
    };
    /** Сообщение с кнопкой карточки контрагента — как его отправил бы бот после поиска. */
    const giveCard = async (login: string, chatId: number, contractorId: string) => {
      const message: BotMessage = {
        text: 'Найдено контрагентов: 2. Выберите нужного.',
        buttons: [[{ text: 'Контрагент', action: BOT_CARD_ACTION, arg: contractorId }]],
      };
      expect(
        await sendBotMessage(
          deps,
          {
            userId:
              login === 'owner-a'
                ? f.a.ownerUserId
                : login === 'owner-b'
                  ? f.b.ownerUserId
                  : person(login).userId,
            chatId,
          },
          message,
          'bot_cmd',
          't',
        ),
      ).toBe(true);
      return last(chatId);
    };

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      tg = createFakeTelegram();
      deps = createTestDeps({
        db: f.t.app.db,
        telegram: tg,
        clock: fixedClock('2026-11-13T03:00:00Z'),
      });
      deps.config = { ...deps.config, APP_BASE_URL: SITE };
      app = createApp(deps);
      await settings(FEATURES);
      await settings(FEATURES, f.b.orgId);
      for (const [login, chat] of [
        ['owner-a', CHAT.owner],
        ['chief-a', CHAT.chief],
        ['acc-a', CHAT.acc],
        ['senior-a', CHAT.senior],
        ['owner-b', CHAT.ownerB],
        ['platform-admin', CHAT.admin],
      ] as const) {
        await linkTelegram(app, await signIn(app, login, TEST_PASSWORD), chat);
      }
      cpAcc = await contractor(
        f.a.orgId,
        CP_ACC,
        '03744097401851',
        person('acc-a').employeeId,
        30_000,
      );
      cpChief = await contractor(
        f.a.orgId,
        CP_CHIEF,
        '20101199000123',
        person('chief-a').employeeId,
        null,
      );
      cpSenior = await contractor(
        f.a.orgId,
        'ОсОО «Старший Клиент»',
        '21503198700015',
        person('senior-a').employeeId,
        9_000,
      );
      cpArchived = await contractor(
        f.a.orgId,
        'ОсОО «Трейд Архив»',
        '03744097401853',
        person('acc-a').employeeId,
        null,
      );
      await f.t.admin.db
        .update(schema.contractors)
        .set({ serviceStatus: 'archived' })
        .where(eq(schema.contractors.id, cpArchived));
      cpB = await contractor(
        f.b.orgId,
        'ОсОО «Чужая Трейд»',
        '03744097401852',
        person('acc-b').employeeId,
        7_000,
      );
      const acc = person('acc-a').employeeId;
      const chief = person('chief-a').employeeId;
      // Бухгалтер: НДС за октябрь — срок сегодня; 1-Т за сентябрь просрочен; НДС за сентябрь сдан, но не
      // оплачен — срок оплаты сегодня.
      await report(cpAcc, 'nds', '2026-10', '2026-11-13', { responsibleEmployeeId: acc });
      await report(cpAcc, 't1m', '2026-09', '2026-10-20', {
        responsibleEmployeeId: acc,
        status: 'in_progress',
      });
      await report(cpAcc, 'nds', '2026-09', '2026-10-26', {
        responsibleEmployeeId: acc,
        status: 'submitted',
        payDue: '2026-11-13',
        amount: 100_000,
        paid: 0,
      });
      // Главный бухгалтер: НДС за октябрь — срок в субботу 14.11; НДС за август сдан, налог просрочен.
      await report(cpChief, 'nds', '2026-10', '2026-11-14', { responsibleEmployeeId: chief });
      await report(cpChief, 'nds', '2026-08', '2026-09-25', {
        responsibleEmployeeId: chief,
        status: 'submitted',
        payDue: '2026-11-02',
        amount: 80_000,
        paid: 30_000,
      });
      // В архиве и в чужой организации — срок сегодня.
      await report(cpArchived, 'nds', '2026-10', '2026-11-13', { responsibleEmployeeId: acc });
      await report(cpB, 'nds', '2026-10', '2026-11-13', {}, f.b.orgId);
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('«Сегодня»: что сдать и что оплатить сегодня, в области сотрудника; кнопка открывает отчёты на сайте', async () => {
      const [m] = await say(CHAT.owner, 'Сегодня');
      const rich = m!.options.rich!;
      expect(rich).toContain('<b>Сегодня, 13 ноября</b>');
      expect(rich).toContain('<i>Сдать 1 · оплатить 1</i>');
      expect(rich).toContain(`<td>${CP_ACC}</td><td>НДС, окт.</td><td>К сдаче</td>`);
      expect(rich).toContain('💳 Оплата налогов');
      expect(rich).toContain(`<td>${CP_ACC}</td><td>НДС, сен.</td><td>Не оплачено</td>`);
      // Архивный контрагент и чужая организация в ответ не попали.
      expect(rich).not.toContain('Архив');
      expect(rich).not.toContain('Чужая');
      expect(keys(m!)).toEqual([{ text: TPL.tgBtnOpenReports, url: `${SITE}/app/reports/week` }]);
      // Команда из меню бота — то же самое; у бухгалтера с областью «Свои» — его отчёты.
      const [slash] = await say(CHAT.owner, '/today');
      expect(slash!.options.rich).toBe(rich);
      const [own] = await say(CHAT.acc, '/today@buhuchet_test_bot');
      expect(own!.options.rich).toBe(rich);
      // У главного бухгалтера «Свои»: сегодня ничего — одной строкой, с кнопками меню под полем ввода.
      await f.t.admin.db
        .delete(schema.rolePermissions)
        .where(
          and(
            eq(schema.rolePermissions.roleId, f.templateRole(f.a, 'chief')),
            eq(schema.rolePermissions.permissionId, 'viewAll'),
          ),
        );
      await f.t.admin.db
        .update(schema.roleScopes)
        .set({ scope: 'own' })
        .where(eq(schema.roleScopes.roleId, f.templateRole(f.a, 'chief')));
      const [none] = await say(CHAT.chief, 'сегодня');
      expect(none!.text).toBe(
        'На сегодня, 13 ноября, ничего нет: отчётов к сдаче и налогов к оплате нет.',
      );
      expect(none!.options.menu).toEqual(MENU);
      // Ответ записан в журнал отправок получателя.
      const [row] = await f.t.admin.db
        .select({ kind: schema.telegramOutbox.kind, status: schema.telegramOutbox.status })
        .from(schema.telegramOutbox)
        .where(eq(schema.telegramOutbox.userId, person('chief-a').userId))
        .orderBy(desc(schema.telegramOutbox.createdAt))
        .limit(1);
      expect(row).toEqual({ kind: 'bot_cmd', status: 'sent' });
    });

    it('«Неделя»: дни до конца недели и итоги с просроченным; «Просрочено»: сначала старые, оплата — с пометкой', async () => {
      const [week] = await say(CHAT.owner, 'Неделя');
      const rich = week!.options.rich!;
      expect(rich).toContain('<b>🗓 Неделя 09.11–15.11</b>');
      expect(rich).toContain('<i>Сдать 2 · оплатить 1 · просрочено 2</i>');
      expect(rich).toContain('<td>Пт, 13.11</td><td align="right">1</td><td align="right">1</td>');
      expect(rich).toContain('<td>Сб, 14.11</td><td align="right">1</td><td align="right">0</td>');
      expect(keys(week!)).toEqual([
        { text: TPL.tgBtnOpenReports, url: `${SITE}/app/reports/week` },
      ]);
      const [own] = await say(CHAT.acc, '/week');
      expect(own!.options.rich).toContain('<i>Сдать 1 · оплатить 1 · просрочено 1</i>');
      expect(own!.options.rich).not.toContain('Сб, 14.11');

      const [over] = await say(CHAT.owner, 'Просрочено');
      expect(over!.options.rich).toContain('<b>🔴 Просрочено · 2</b>');
      const rows = [...over!.options.rich!.matchAll(/<tr><td>(.*?)<\/tr>/g)].map((x) => x[1]);
      expect(rows).toEqual([
        `${CP_ACC}</td><td>1-Т, сен.</td><td align="right">20.10</td>`,
        `${CP_CHIEF}</td><td>НДС, авг. — оплата</td><td align="right">02.11</td>`,
      ]);
      expect(keys(over!)).toEqual([{ text: TPL.tgBtnOpenReports, url: `${SITE}/app/reports/all` }]);
      const [mine] = await say(CHAT.chief, '/overdue');
      expect(mine!.options.rich).toContain('<b>🔴 Просрочено · 1</b>');
      expect(mine!.options.rich).not.toContain(CP_ACC);

      // «Учёт оплаты налогов» выключен — оплаты в ответах нет.
      await settings({ ...FEATURES, taxpay: false });
      const [noPay] = await say(CHAT.owner, '/overdue');
      expect(noPay!.options.rich).toContain('<b>🔴 Просрочено · 1</b>');
      expect((await say(CHAT.chief, '/overdue'))[0]!.text).toBe(TPL.tgOverNone);
      await settings(FEATURES);
    });

    it('отказы: непривязанный чат, нет права, выключенные напоминания, блокировка, временный пароль, администратор платформы', async () => {
      // Непривязанный чат — прежняя подсказка, кнопки меню убираются.
      const [start] = await say(CHAT.nobody, '/today');
      expect(start!.text).toBe(TPL.tgStart);
      expect(start!.options.menu).toEqual([]);
      // «Старший»: право только на контрагентов — отчёты не показываются, поиск работает.
      for (const text of ['Сегодня', '/week', '/overdue']) {
        const [m] = await say(CHAT.senior, text);
        expect(m).toMatchObject({ text: NO_RIGHT, options: { menu: MENU } });
      }
      expect((await say(CHAT.senior, '/find'))[0]!.text).toBe(TPL.tgFindAsk);
      // Администратор платформы — не сотрудник организации.
      expect((await say(CHAT.admin, '/today'))[0]!.text).toBe(NO_RIGHT);
      // «Напоминания в Telegram» организации выключены.
      await settings({ ...FEATURES, telegram: false });
      expect((await say(CHAT.owner, '/today'))[0]!.text).toBe(NO_RIGHT);
      expect((await say(CHAT.owner, '/find'))[0]!.text).toBe(NO_RIGHT);
      await settings(FEATURES);
      // Блокировка учётной записи, сотрудника и организации; временный пароль.
      await user('acc-a', { blocked: true });
      expect((await say(CHAT.acc, '/today'))[0]!.text).toBe(NO_RIGHT);
      await user('acc-a', { blocked: false, mustChangePassword: true });
      expect((await say(CHAT.acc, '/today'))[0]!.text).toBe(NO_RIGHT);
      await user('acc-a', { mustChangePassword: false });
      // Пароль сброшен, действует разрешение привязать Telegram без кода: прежнему чату бот не доверяет.
      await f.t.admin.db.insert(schema.telegramLinkGuards).values({
        userId: person('acc-a').userId,
        orgId: f.a.orgId,
        freeUntil: new Date(Date.now() + 3_600_000),
      });
      expect((await say(CHAT.acc, '/today'))[0]!.text).toBe(NO_RIGHT);
      await f.t.admin.db
        .delete(schema.telegramLinkGuards)
        .where(eq(schema.telegramLinkGuards.userId, person('acc-a').userId));
      await f.t.admin.db
        .update(schema.employees)
        .set({ active: false })
        .where(eq(schema.employees.id, person('acc-a').employeeId));
      expect((await say(CHAT.acc, '/find'))[0]!.text).toBe(NO_RIGHT);
      await f.t.admin.db
        .update(schema.employees)
        .set({ active: true })
        .where(eq(schema.employees.id, person('acc-a').employeeId));
      await f.t.admin.db
        .update(schema.organizations)
        .set({ status: 'blocked' })
        .where(eq(schema.organizations.id, f.a.orgId));
      expect((await say(CHAT.acc, '/today'))[0]!.text).toBe(NO_RIGHT);
      await f.t.admin.db
        .update(schema.organizations)
        .set({ status: 'active' })
        .where(eq(schema.organizations.id, f.a.orgId));
      expect((await say(CHAT.acc, '/today'))[0]!.options.rich).toContain('Сегодня, 13 ноября');
      // Чужой человек в чате (не хозяин личного чата) и не команда — не команды.
      const before = tg.sent.length;
      await sendToBot(app, telegramUpdate('/today', CHAT.acc, { fromId: 1 }));
      expect(tg.sent.slice(before).map((m) => m.text)).toEqual([HINT]);
    });

    it('«Найти контрагента»: просьба, короткий и пустой запрос, список с кнопками, карточка; новая просьба отменяет прежнюю', async () => {
      const [ask] = await say(CHAT.owner, 'Найти контрагента');
      expect(ask!.text).toBe(TPL.tgFindAsk);
      expect(keys(ask!)).toEqual([{ text: TPL.tgBtnCancel, data: 'askCancel' }]);
      // Команда меню при открытой просьбе — команда, а не запрос поиска; просьба остаётся открытой.
      expect((await say(CHAT.owner, 'Сегодня'))[0]!.options.rich).toContain('Сегодня, 13 ноября');
      // Подпись кнопки ответом (reply) на просьбу — запрос поиска, а не команда; «/overdue» — команда.
      expect((await say(CHAT.owner, 'Просрочено', ask!.id))[0]!.text).toBe(TPL.tgFindNone);
      expect((await say(CHAT.owner, '/overdue', ask!.id))[0]!.options.rich).toContain(
        'Просрочено · ',
      );
      // Короткий запрос и «не найден» — бот ждёт другой ответ.
      expect((await say(CHAT.owner, 'т'))[0]!.text).toBe(
        'Слишком коротко. Напишите не меньше 2 знаков названия или начало ИНН.',
      );
      expect((await say(CHAT.owner, 'ромашка'))[0]!.text).toBe(TPL.tgFindNone);
      // Несколько найденных — кнопки с названиями: без архивного и без чужой организации.
      const edits = tg.edits.length;
      const [list] = await say(CHAT.owner, 'ТРЕЙД');
      expect(list!.text).toBe('Найдено контрагентов: 2. Выберите нужного.');
      expect(keys(list!)).toEqual([
        { text: CP_CHIEF, data: `${BOT_CARD_ACTION}:${cpChief}` },
        { text: CP_ACC, data: `${BOT_CARD_ACTION}:${cpAcc}` },
      ]);
      // Просьба закрыта: «Отмена» погасла; следующий текст — уже не запрос.
      expect(tg.edits.slice(edits)).toEqual([
        {
          chatId: CHAT.owner,
          messageId: ask!.id,
          keyboard: [[{ text: TPL.tgBtnCancel, data: 'off', disabled: true }]],
        },
      ]);
      expect((await say(CHAT.owner, 'трейд'))[0]!.text).toBe(HINT);

      // Кнопка с названием — карточка; кнопка остаётся активной, карточку можно запросить снова.
      const answer = await press(CHAT.owner, list!.id, `${BOT_CARD_ACTION}:${cpAcc}`);
      expect(answer.text).toBeUndefined();
      const card = last(CHAT.owner);
      const rich = card.options.rich!;
      expect(rich).toContain(`<b>${CP_ACC}</b>`);
      expect(rich).toContain('<i>Ответственный: acc-a · обслуживается с 01.07.2026</i>');
      expect(card.text).toMatch(/Долг за обслуживание: [\d\s]+,00 сом за \d+ мес\./);
      // Отчёты карточки: просроченный несданный и со сроком в этом месяце.
      const rows = [...rich.matchAll(/<tr><td>(.*?)<\/tr>/g)].map((x) => x[1]);
      expect(rows).toEqual([
        '1-Т, сен.</td><td align="right">20.10</td><td>В работе</td>',
        'НДС, окт.</td><td align="right">13.11</td><td>К сдаче</td>',
      ]);
      expect(keys(card)).toEqual([
        { text: TPL.tgBtnOpenCp, url: `${SITE}/app/cps/all?contractor=${cpAcc}` },
      ]);
      expect(tg.edits).toHaveLength(edits + 1);
      await press(CHAT.owner, list!.id, `${BOT_CARD_ACTION}:${cpChief}`);
      const second = last(CHAT.owner);
      expect(second.options.rich).toContain(`<b>${CP_CHIEF}</b>`);
      // У контрагента без ставки долга нет; отчёт этого месяца — в таблице.
      expect(second.text).toContain('Долг за обслуживание: нет');

      // Один найденный — сразу карточка: у бухгалтера с областью «Свои» по «трейд» — только свой.
      const [askAcc] = await say(CHAT.acc, '/find');
      const [found] = await say(CHAT.acc, 'трейд', askAcc!.id);
      expect(found!.options.rich).toContain(`<b>${CP_ACC}</b>`);
      // По началу ИНН.
      await say(CHAT.acc, '/find');
      expect((await say(CHAT.acc, '0374409740185'))[0]!.options.rich).toContain(`<b>${CP_ACC}</b>`);

      // Новая просьба отменяет прежнюю: бот ждёт один ответ.
      const [first] = await say(CHAT.acc, '/find');
      const editsBefore = tg.edits.length;
      const [next] = await say(CHAT.acc, '/find');
      expect(tg.edits.slice(editsBefore)).toEqual([
        {
          chatId: CHAT.acc,
          messageId: first!.id,
          keyboard: [[{ text: TPL.tgBtnCancel, data: 'off', disabled: true }]],
        },
      ]);
      // «Отмена» под просьбой — бот больше не ждёт.
      await press(CHAT.acc, next!.id, 'askCancel');
      expect((await say(CHAT.acc, 'трейд'))[0]!.text).toBe(HINT);
    });

    it('«Действия из Telegram» выключены: команды, поиск и карточка работают — они ничего не меняют', async () => {
      const actions = (on: boolean) =>
        f.t.admin.db
          .update(schema.orgSettings)
          .set({ telegramActions: on })
          .where(eq(schema.orgSettings.orgId, f.a.orgId));
      await actions(false);
      try {
        expect((await say(CHAT.owner, '/today'))[0]!.options.rich).toContain('Сегодня, 13 ноября');
        const [ask] = await say(CHAT.owner, '/find');
        expect(ask!.text).toBe(TPL.tgFindAsk);
        const [list] = await say(CHAT.owner, 'трейд', ask!.id);
        expect(list!.text).toBe('Найдено контрагентов: 2. Выберите нужного.');
        await press(CHAT.owner, list!.id, `${BOT_CARD_ACTION}:${cpAcc}`);
        expect(last(CHAT.owner).options.rich).toContain(`<b>${CP_ACC}</b>`);
      } finally {
        await actions(true);
      }
    });

    it('карточка: чужая организация, область «Свои», архив и права проверяются при каждом нажатии', async () => {
      // Бухгалтер с областью «Свои»: чужой контрагент своей организации, архивный и контрагент чужой
      // организации — «Нет права», сообщение с карточкой не уходит.
      for (const id of [cpChief, cpArchived, cpB, '00000000-0000-4000-8000-000000000000']) {
        const m = await giveCard('acc-a', CHAT.acc, id);
        const count = sent(CHAT.acc).length;
        const answer = await press(CHAT.acc, m.id, `${BOT_CARD_ACTION}:${id}`);
        expect(answer).toMatchObject({ text: NO_RIGHT, alert: true });
        expect(sent(CHAT.acc)).toHaveLength(count);
      }
      // Владелец чужой организации контрагента организации А не видит — и по поиску тоже.
      const foreign = await giveCard('owner-b', CHAT.ownerB, cpAcc);
      expect(await press(CHAT.ownerB, foreign.id, `${BOT_CARD_ACTION}:${cpAcc}`)).toMatchObject({
        text: NO_RIGHT,
      });
      await say(CHAT.ownerB, '/find');
      expect((await say(CHAT.ownerB, 'ала-тоо'))[0]!.text).toBe(TPL.tgFindNone);
      const [onlyB] = await say(CHAT.ownerB, 'трейд');
      expect(onlyB!.options.rich).toContain('<b>ОсОО «Чужая Трейд»</b>');

      // «Старший»: право на контрагентов без права на отчёты и на плату — в карточке нет ни отчётов, ни
      // долга.
      const m = await giveCard('senior-a', CHAT.senior, cpSenior);
      await press(CHAT.senior, m.id, `${BOT_CARD_ACTION}:${cpSenior}`);
      const card = last(CHAT.senior);
      expect(card.text).toContain('ОсОО «Старший Клиент»');
      expect(card.text).not.toContain('Долг за обслуживание');
      expect(card.text).not.toContain(TPL.tgCardNoReports);
      expect(card.options.rich ?? '').not.toContain('<table');
      // Право забрали — кнопка под старым сообщением отвечает «Нет права».
      await f.t.admin.db
        .delete(schema.rolePermissions)
        .where(
          and(
            eq(schema.rolePermissions.roleId, f.roleIds.senior),
            eq(schema.rolePermissions.permissionId, 'cpView'),
          ),
        );
      expect(await press(CHAT.senior, m.id, `${BOT_CARD_ACTION}:${cpSenior}`)).toMatchObject({
        text: NO_RIGHT,
      });
      expect((await say(CHAT.senior, '/find'))[0]!.text).toBe(NO_RIGHT);
      await f.t.admin.db
        .insert(schema.rolePermissions)
        .values({ orgId: f.a.orgId, roleId: f.roleIds.senior, permissionId: 'cpView' });

      // «Плата за обслуживание» выключена — долга в карточке нет; нет отчётов — строка об этом.
      await settings({ ...FEATURES, fee: false });
      const own = await giveCard('owner-a', CHAT.owner, cpSenior);
      await press(CHAT.owner, own.id, `${BOT_CARD_ACTION}:${cpSenior}`);
      expect(last(CHAT.owner).text).not.toContain('Долг за обслуживание');
      expect(last(CHAT.owner).text).toContain(TPL.tgCardNoReports);
      await settings(FEATURES);
      // Приостановленное обслуживание — пометкой.
      await f.t.admin.db
        .update(schema.contractors)
        .set({ serviceStatus: 'paused' })
        .where(eq(schema.contractors.id, cpSenior));
      await press(CHAT.owner, own.id, `${BOT_CARD_ACTION}:${cpSenior}`);
      expect(last(CHAT.owner).text).toContain(
        'Ответственный: senior-a · обслуживается с 01.07.2026 · обслуживание приостановлено',
      );
      // Просьба поиска сама ничего не разрешает: ответ на чужую просьбу из другого чата не принимается.
      const [ask] = await say(CHAT.owner, '/find');
      expect((await say(CHAT.acc, 'трейд', ask!.id))[0]!.text).toBe(HINT);
      await press(CHAT.owner, ask!.id, 'askCancel');
    });

    it('один Telegram у двух учётных записей: отвечает каждая, с названием организации', async () => {
      // Владелец организации Б привязывает тот же Telegram, что у бухгалтера организации А.
      await linkTelegram(app, await signIn(app, 'acc-b', TEST_PASSWORD), CHAT.acc);
      const answers = await say(CHAT.acc, '/today');
      expect(answers).toHaveLength(2);
      expect(answers[0]!.options.rich).toContain('<b>Организация А\nСегодня, 13 ноября</b>');
      expect(answers[0]!.options.rich).toContain(CP_ACC);
      expect(answers[0]!.options.rich).not.toContain('Чужая');
      expect(answers[1]!.options.rich).toContain('<b>Организация Б\nСегодня, 13 ноября</b>');
      expect(answers[1]!.options.rich).toContain('ОсОО «Чужая Трейд»');
      expect(answers[1]!.options.rich).not.toContain(CP_ACC);
      // Просьба поиска — от каждой учётной записи; ответ на сообщение — в свою организацию.
      const asks = await say(CHAT.acc, '/find');
      expect(asks.map((m) => m.text)).toEqual([
        `Организация А\n${TPL.tgFindAsk}`,
        `Организация Б\n${TPL.tgFindAsk}`,
      ]);
      const [inA] = await say(CHAT.acc, 'трейд', asks[0]!.id);
      expect(inA!.options.rich).toContain(`<b>Организация А\n${CP_ACC}</b>`);
      const [inB] = await say(CHAT.acc, 'трейд', asks[1]!.id);
      expect(inB!.options.rich).toContain('<b>Организация Б\nОсОО «Чужая Трейд»</b>');
    });

    it('подсказка и меню: кнопки под полем ввода приходят с привязкой и с подсказкой; команды — в меню бота', async () => {
      const linked = sent(CHAT.owner).find((m) => m.text.includes('Telegram привязан'));
      expect(linked!.options.menu).toEqual(MENU);
      const [hint] = await say(CHAT.owner, 'привет');
      expect(hint).toMatchObject({ text: HINT, options: { menu: MENU } });
      expect((await say(CHAT.owner, '/start'))[0]).toMatchObject({ text: HINT });
      const [start] = await say(CHAT.nobody, 'привет');
      expect(start).toMatchObject({ text: TPL.tgStart, options: { menu: [] } });
      // Меню команд бота сайт сообщает Telegram вместе с адресом вебхука.
      await telegramWebhookJob({ url: `${SITE}/api/telegram/webhook`, secretToken: 's' }).run(
        deps,
        deps.clock.now(),
      );
      expect(tg.commands).toEqual([
        { command: 'today', description: 'Сегодня' },
        { command: 'week', description: 'Неделя' },
        { command: 'overdue', description: 'Просрочено' },
        { command: 'find', description: 'Найти контрагента' },
      ]);
    });

    it('одно сообщение — один ответ; команд с одного чата — не больше предела в минуту', async () => {
      const update = telegramUpdate('/today', CHAT.owner);
      const before = sent(CHAT.owner).length;
      await sendToBot(app, update);
      await sendToBot(app, update);
      expect(sent(CHAT.owner)).toHaveLength(before + 1);
      for (let i = 0; i < BOT_PRESS_RATE_LIMIT.max; i++) {
        await sendToBot(app, telegramUpdate('/today', CHAT.flood));
      }
      expect(last(CHAT.flood).text).toBe(TPL.tgStart);
      expect((await say(CHAT.flood, '/today'))[0]!.text).toBe(TPL.tgActFailed);
    });
  },
);
