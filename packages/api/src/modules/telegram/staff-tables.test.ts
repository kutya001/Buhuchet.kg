import {
  createFakeTelegram,
  fixedClock,
  type FakeTelegram,
  type FixedClock,
} from '@buhuchet/adapters';
import { createManualReport, schema, withOrgContext } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  BOT_COPY_MAX,
  STAFF_BOT_NUDGE,
  TELEGRAM_TEMPLATE_DEFAULTS,
  type BotMessage,
  type IsoDate,
} from '@buhuchet/domain';
import { FeeReminder } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
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
  TEST_PASSWORD,
} from '../../testing';
import { sendBotMessage } from './bot';
import { BOT_PRESS_RATE_LIMIT } from './press';
import { buildDailyReminders, telegramRemindersJob } from './reminders';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type App = ReturnType<typeof createApp>;

const TPL = TELEGRAM_TEMPLATE_DEFAULTS;
const SITE = 'https://stand.example';
const noPause = async () => {};
const CHAT = { owner: 7200, chief: 7201, acc: 7202, ownerB: 7300, accB: 7301 } as const;
const CP_ACC = 'ОсОО «Ала-Тоо Трейд»';
const CP_HR = 'ИП Садыкова';
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{([^}]+)\}/g, (_, k: string) => String(values[k] ?? ''));
const spaces = (text: string) => text.replace(/\s/g, ' ');

// Таблицы в сообщениях бота (поток Т, задача Т3; пакет заказчика 13.11.2026, идеи 2, 8 и 10; прототип
// v100 modules/tg-tables.js). Понедельник, 19.10.2026, 09:00 по Бишкеку.
describe.skipIf(!databaseAvailable())(
  'Таблицы бота: утреннее напоминание, сводка недели, «Напомнить», долги за обслуживание (Т3)',
  () => {
    let f: Fixture;
    let tg: FakeTelegram;
    let clock: FixedClock;
    let deps: ApiDeps;
    let app: App;
    let owner = '';
    let ownerShort = '';
    let cpAcc = '';
    let cpHr = '';
    /** Сводки недели владельца и главного бухгалтера — сообщения с кнопками «Напомнить». */
    let weekOwner: ReturnType<typeof sent>[number];
    let weekChief: ReturnType<typeof sent>[number];

    const person = (login: string) => f.people[login]!;
    const sent = (chatId: number) =>
      tg.sent.map((m, i) => ({ ...m, id: tg.messageIds[i]! })).filter((m) => m.chatId === chatId);
    const last = (chatId: number) => sent(chatId).at(-1)!;
    const keys = (m: { options: FakeTelegram['sent'][number]['options'] }) =>
      (m.options.keyboard ?? []).flat();
    const press = async (chatId: number, messageId: number, data: string) => {
      const res = await sendToBot(app, telegramPress(data, chatId, messageId));
      expect(res.status).toBe(200);
      return tg.answers.at(-1)!;
    };
    const nudge = (employeeId: string) => `${STAFF_BOT_NUDGE}:${employeeId}`;
    /** Сообщение с кнопкой «Напомнить» получателю — как его отправил бы бот. */
    const give = async (userId: string, chatId: number, employeeId: string) => {
      const message: BotMessage = {
        heading: 'Неделя',
        buttons: [[{ text: 'Напомнить', action: STAFF_BOT_NUDGE, arg: employeeId }]],
      };
      expect(await sendBotMessage(deps, { userId, chatId }, message, 'reminders', 't')).toBe(true);
      return last(chatId);
    };
    const outbox = (kind: 'nudge' | 'reminders', userId: string) =>
      f.t.admin.db
        .select({ id: schema.telegramOutbox.id, status: schema.telegramOutbox.status })
        .from(schema.telegramOutbox)
        .where(and(eq(schema.telegramOutbox.kind, kind), eq(schema.telegramOutbox.userId, userId)));
    const manual = async (
      contractorId: string,
      reportTypeCode: string,
      month: string,
      due: IsoDate,
      patch: Partial<typeof schema.reports.$inferInsert> = {},
      orgId = f.a.orgId,
      userId = f.a.ownerUserId,
    ) => {
      const { id } = await withOrgContext(f.t.app.db, { orgId, userId }, (tx) =>
        createManualReport(
          tx,
          {
            contractorId,
            reportTypeCode,
            month,
            eventDate: null,
            due: '2026-10-22',
            reasonCode: 'ПРЧ-001',
            reasonName: 'Продление от госоргана',
          },
          { today: clock.today(), scope: undefined },
        ),
      );
      await f.t.admin.db
        .update(schema.reports)
        .set({ dueDate: due, ...patch })
        .where(eq(schema.reports.id, id));
      return id;
    };
    async function contractor(
      orgId: string,
      name: string,
      inn: string,
      responsible: string,
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
    const FEATURES = { telegram: true, tasks: true, fee: true, taxpay: true };
    const settings = (patch: Partial<typeof schema.orgSettings.$inferInsert>) =>
      f.t.admin.db
        .update(schema.orgSettings)
        .set(patch)
        .where(eq(schema.orgSettings.orgId, f.a.orgId));
    const chiefRole = () => f.templateRole(f.a, 'chief');
    const chiefRight = async (permissionId: string, on: boolean) => {
      const where = and(
        eq(schema.rolePermissions.roleId, chiefRole()),
        eq(schema.rolePermissions.permissionId, permissionId),
      );
      if (on) {
        await f.t.admin.db
          .insert(schema.rolePermissions)
          .values({ orgId: f.a.orgId, roleId: chiefRole(), permissionId });
      } else await f.t.admin.db.delete(schema.rolePermissions).where(where);
    };
    /**
     * Область группы у главного бухгалтера: «Свои» — без права «Видеть данные всех» (с ним область всегда
     * «Все»).
     */
    const chiefScope = async (group: 'reports' | 'cps', scope: 'own' | 'all') => {
      await chiefRight('viewAll', scope === 'all');
      await f.t.admin.db
        .update(schema.roleScopes)
        .set({ scope })
        .where(
          and(eq(schema.roleScopes.roleId, chiefRole()), eq(schema.roleScopes.permGroup, group)),
        );
    };
    /** Сводка недели получателя из сообщений дня (без отправки): null — сводки нет. */
    const weekOf = async (userId: string): Promise<BotMessage | null> => {
      const day = clock.today();
      const messages = await withOrgContext(f.t.app.db, { orgId: f.a.orgId, kind: 'job' }, (tx) =>
        buildDailyReminders(deps, tx, day, SITE),
      );
      return (
        messages.find((m) => m.userId === userId && m.dedupeKey?.endsWith(':week'))?.message ?? null
      );
    };

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      tg = createFakeTelegram();
      clock = fixedClock('2026-10-19T03:00:00Z');
      deps = createTestDeps({ db: f.t.app.db, telegram: tg, clock });
      app = createApp(deps);
      await settings({ features: FEATURES, remindDays: [3], reportConfirm: true });
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: FEATURES, remindDays: [3] })
        .where(eq(schema.orgSettings.orgId, f.b.orgId));
      const cookies: Record<string, string> = {};
      // У сотрудника hr-a Telegram не привязан.
      for (const [login, chat] of [
        ['owner-a', CHAT.owner],
        ['chief-a', CHAT.chief],
        ['acc-a', CHAT.acc],
        ['owner-b', CHAT.ownerB],
        ['acc-b', CHAT.accB],
      ] as const) {
        cookies[login] = await signIn(app, login, TEST_PASSWORD);
        await linkTelegram(app, cookies[login]!, chat);
      }
      owner = cookies['owner-a']!;
      const [me] = await f.t.admin.db
        .select({ shortName: schema.employees.shortName })
        .from(schema.employees)
        .where(eq(schema.employees.id, f.a.ownerEmployeeId));
      ownerShort = me!.shortName;
      cpAcc = await contractor(
        f.a.orgId,
        CP_ACC,
        '03744097401851',
        person('acc-a').employeeId,
        30_000,
      );
      cpHr = await contractor(f.a.orgId, CP_HR, '21503198700015', person('hr-a').employeeId, 5_000);
      const cpChief = await contractor(
        f.a.orgId,
        'ИП Садыков',
        '20101199000123',
        person('chief-a').employeeId,
        null,
      );
      const cpB = await contractor(
        f.b.orgId,
        'ОсОО «Чужая»',
        '03744097401852',
        person('acc-b').employeeId,
        7_000,
      );
      // Бухгалтер: 1-Т к 22.10 (через 3 дня), НДС просрочен и по сдаче, и по оплате.
      await manual(cpAcc, 't1m', '2026-09-01', '2026-10-22');
      await manual(cpAcc, 'nds', '2026-08-01', '2026-10-14', {
        amount: 100_000,
        paid: 0,
        payDue: '2026-10-16',
      });
      // Сотрудник без Telegram: просроченный 1-Т; главный бухгалтер: 1-Т к 22.10.
      await manual(cpHr, 't1m', '2026-08-01', '2026-10-12');
      await manual(cpChief, 't1m', '2026-09-01', '2026-10-22');
      await manual(cpB, 't1m', '2026-08-01', '2026-10-12', {}, f.b.orgId, f.b.ownerUserId);
      tg.sent.length = 0;
      tg.messageIds.length = 0;
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('утреннее напоминание — таблицами по разделам; простой текст — прежние строки', async () => {
      await telegramRemindersJob(SITE, noPause).run(deps, clock.now());
      const day = sent(CHAT.acc)[0]!;
      const rich = day.options.rich!;
      expect(rich).toContain('<b>Отчёты на понедельник, 19 октября</b>');
      expect(rich).toContain('<i>Просрочено 1 · сегодня 0 · скоро 1 · оплата 1</i>');
      expect(rich).toContain('<details open><summary>🔴 Просрочено · 1</summary>');
      expect(rich).toContain(`<td>${CP_ACC}</td><td>НДС, авг.</td><td align="right">14.10</td>`);
      expect(rich).toContain('<details><summary>⏰ Через 3 дн. · 1</summary>');
      expect(rich).toContain(`<td>${CP_ACC}</td><td>1-Т, сен.</td><td align="right">22.10</td>`);
      // Оплата налога — своим разделом со сроком оплаты.
      expect(rich).toContain('<details><summary>💳 Оплата налогов · 1</summary>');
      expect(rich).toContain(`<td>${CP_ACC}</td><td>НДС, авг.</td><td align="right">16.10</td>`);
      // Сводка сотрудника на неделю остаётся строкой текста над таблицами, как раньше.
      expect(rich).toContain('🗓 Неделя 19.10–25.10');
      expect(day.text).toContain('🔴 Просрочено: НДС за Август 2026');
      expect(day.text).toContain('⏰ Через 3 дн. срок сдачи: 1-Т за Сентябрь 2026');
      expect(day.text).not.toContain('<');
      // Сотруднику сводка недели с таблицей не приходит.
      expect(sent(CHAT.acc).some((m) => keys(m).some((b) => b.data?.startsWith('nudge')))).toBe(
        false,
      );
      // Владельцу чужие отчёты — в тех же разделах; у отчёта сотрудника без Telegram — пометка.
      const boss = sent(CHAT.owner)[0]!;
      expect(boss.options.rich).toContain('<td>1-Т, авг. (hr-a: не привязан Telegram)</td>');
    });

    it('сводка недели владельцу: таблица по сотрудникам, «Напомнить», долги за обслуживание и «Скопировать напоминание»', async () => {
      weekOwner = last(CHAT.owner);
      weekChief = last(CHAT.chief);
      const week = weekOwner;
      const lines = week.text.split('\n').map(spaces);
      expect(lines.slice(0, 5)).toEqual([
        '🗓 Неделя 19.10–25.10',
        'Сдать 2 · оплатить 0 · просрочено 3',
        '• acc-a — Сдать 1 — Просроч. 2 — Ждут 0',
        '• hr-a — Сдать 0 — Просроч. 1 — Ждут 0',
        '• chief-a — Сдать 1 — Просроч. 0 — Ждут 0',
      ]);
      // Долги: большие первыми, итог — по всем; чужой организации нет.
      expect(lines[5]).toBe('💰 Долги за обслуживание · 2');
      expect(lines[6]).toMatch(new RegExp(`^• ${CP_ACC} — Долг, сом [\\d ]+,00 — Мес\\. \\d$`));
      expect(lines[7]).toMatch(new RegExp(`^• ${CP_HR} — Долг, сом [\\d ]+,00 — Мес\\. \\d$`));
      expect(lines[8]).toMatch(/^Всего — [\d ]+,00$/);
      expect(week.text).not.toContain('Чужая');
      expect(week.options.rich).toContain(
        '<details><summary>💰 Долги за обслуживание · 2</summary>',
      );
      expect(week.options.rich).toContain('<th>Сотрудник</th><th align="right">Сдать</th>');
      // Кнопки: «Напомнить» — сотрудникам с просроченным; «Скопировать напоминание» — должникам.
      const buttons = keys(week);
      expect(buttons.slice(0, 2)).toEqual([
        { text: 'Напомнить: acc-a · просрочено 2', data: nudge(person('acc-a').employeeId) },
        { text: 'Напомнить: hr-a · просрочено 1', data: nudge(person('hr-a').employeeId) },
      ]);
      expect(buttons.slice(2).map((b) => b.text)).toEqual([
        `Скопировать напоминание: ${CP_ACC}`,
        `Скопировать напоминание: ${CP_HR}`,
      ]);
      // Текст для копирования — тот же, что открывает «Напомнить в WhatsApp» на сайте.
      for (const [id, button] of [
        [cpAcc, buttons[2]!],
        [cpHr, buttons[3]!],
      ] as const) {
        const res = await apiRequest(app, 'GET', `/api/contractors/${id}/fee-reminder`, owner);
        expect(res.status, await res.clone().text()).toBe(200);
        const site = FeeReminder.parse(await res.json()).text;
        expect(site.length).toBeLessThanOrEqual(BOT_COPY_MAX);
        expect(button.copy).toBe(site);
      }
      // Главный бухгалтер получает такую же сводку; повторный запуск в тот же день её не дублирует.
      expect(keys(weekChief).map((b) => b.text)).toEqual(buttons.map((b) => b.text));
      const before = tg.sent.length;
      await telegramRemindersJob(SITE, noPause).run(deps, clock.now());
      expect(tg.sent).toHaveLength(before);
    });

    it('«Напомнить»: сотрудник получает список просроченного; одному сотруднику — раз в день, кто бы ни нажал', async () => {
      const acc = person('acc-a');
      const week = weekOwner;
      const from = sent(CHAT.acc).length;
      const ok = await press(CHAT.owner, week.id, nudge(acc.employeeId));
      expect(ok).toMatchObject({
        text: fill(TPL.tgActNudgeOk, { сотрудник: 'acc-a', n: 2 }),
        alert: false,
      });
      // Кнопка погасла с новой подписью, остальные — на месте.
      const edited = tg.edits.at(-1)!;
      expect(edited.messageId).toBe(week.id);
      expect(edited.keyboard.flat()[0]).toMatchObject({ text: '✓ Напомнили', disabled: true });
      expect(edited.keyboard.flat()[1]).toMatchObject({ data: nudge(person('hr-a').employeeId) });
      // Сотруднику — сообщение с таблицей просроченного: сдача и оплата, самые давние первыми.
      const got = sent(CHAT.acc).slice(from);
      expect(got).toHaveLength(1);
      expect(got[0]!.text.split('\n')).toEqual([
        fill(TPL.tgNudge, { кто: ownerShort, n: 2 }),
        `• ${CP_ACC} — НДС, авг. — Срок 14.10`,
        `• ${CP_ACC} — НДС, авг. — оплата — Срок 16.10`,
      ]);
      expect(got[0]!.options.rich).toContain(
        '<td>НДС, авг. — оплата</td><td align="right">16.10</td>',
      );
      // Адрес сайта в тестах сервера — http: кнопки-ссылки «Открыть отчёты на сайте» нет (она — только у
      // сайта по https, тест правил `nudgeBotMessage`).
      expect(keys(got[0]!)).toEqual([]);
      expect(await outbox('nudge', acc.userId)).toEqual([
        { id: expect.any(String), status: 'sent' },
      ]);
      // Второе нажатие той же кнопки — «Кнопка устарела»; главный бухгалтер своей кнопкой — «уже
      // получил напоминание сегодня», второго сообщения нет, его кнопка остаётся.
      expect(await press(CHAT.owner, week.id, nudge(acc.employeeId))).toMatchObject({
        text: TPL.tgActStale,
        alert: true,
      });
      const edits = tg.edits.length;
      expect(await press(CHAT.chief, weekChief.id, nudge(acc.employeeId))).toMatchObject({
        text: fill(TPL.tgActNudgeWait, { сотрудник: 'acc-a', n: 2 }),
        alert: true,
      });
      expect(tg.edits).toHaveLength(edits);
      expect(sent(CHAT.acc)).toHaveLength(from + 1);
      expect(await outbox('nudge', acc.userId)).toHaveLength(1);
      // На следующий день напомнить можно снова — и при выключенных «Действиях из Telegram»: данные
      // кнопка не меняет.
      clock.advance(24 * 3600_000);
      await settings({ telegramActions: false });
      expect(await press(CHAT.chief, weekChief.id, nudge(acc.employeeId))).toMatchObject({
        text: fill(TPL.tgActNudgeOk, { сотрудник: 'acc-a', n: 2 }),
      });
      expect(sent(CHAT.acc)).toHaveLength(from + 2);
      expect(last(CHAT.acc).text).toContain(fill(TPL.tgNudge, { кто: 'chief-a', n: 2 }));
      await settings({ telegramActions: true });
      clock.set('2026-10-19T03:00:00Z');
    });

    it('«Напомнить»: у сотрудника нет Telegram, нет просроченного, сам себе, уволенный, выключены напоминания', async () => {
      const hr = person('hr-a');
      const week = weekOwner;
      const total = tg.sent.length;
      // Telegram не привязан — отказ с подсказкой, кнопка остаётся, в очереди ничего.
      expect(await press(CHAT.owner, week.id, nudge(hr.employeeId))).toMatchObject({
        text: fill(TPL.tgActNudgeNoTg, { сотрудник: 'hr-a', n: 1 }),
        alert: true,
      });
      expect(await outbox('nudge', hr.userId)).toEqual([]);
      // Просроченного нет — «Кнопка устарела»; себе не напоминают — «Нет права».
      const ownerUser = f.a.ownerUserId;
      const toChief = await give(ownerUser, CHAT.owner, person('chief-a').employeeId);
      expect(
        await press(CHAT.owner, toChief.id, nudge(person('chief-a').employeeId)),
      ).toMatchObject({ text: TPL.tgActStale, alert: true });
      const toSelf = await give(ownerUser, CHAT.owner, f.a.ownerEmployeeId);
      expect(await press(CHAT.owner, toSelf.id, nudge(f.a.ownerEmployeeId))).toMatchObject({
        text: TPL.tgActNoRight,
        alert: true,
      });
      // Уволенный сотрудник — «Нет права».
      const active = (on: boolean) =>
        f.t.admin.db
          .update(schema.employees)
          .set({ active: on })
          .where(eq(schema.employees.id, hr.employeeId));
      await active(false);
      expect(await press(CHAT.owner, week.id, nudge(hr.employeeId))).toMatchObject({
        text: TPL.tgActNoRight,
      });
      await active(true);
      // «Напоминания в Telegram» организации выключены — кнопка устарела.
      await settings({ features: { ...FEATURES, telegram: false } });
      expect(await press(CHAT.owner, week.id, nudge(hr.employeeId))).toMatchObject({
        text: TPL.tgActStale,
      });
      await settings({ features: FEATURES });
      // Ни одно из этих нажатий никому ничего не отправило (кроме двух сообщений-заготовок теста).
      expect(tg.sent).toHaveLength(total + 2);
    });

    it('«Напомнить»: чужая организация, область «Свои» и право проверяются при нажатии', async () => {
      const acc = person('acc-a');
      const accB = person('acc-b');
      clock.advance(2 * 24 * 3600_000);
      const quiet = async (run: () => Promise<unknown>) => {
        const before = { sent: tg.sent.length, a: (await outbox('nudge', acc.userId)).length };
        const answer = await run();
        expect(answer).toMatchObject({ text: TPL.tgActNoRight, alert: true });
        expect(tg.sent).toHaveLength(before.sent);
        expect(await outbox('nudge', acc.userId)).toHaveLength(before.a);
        expect(await outbox('nudge', accB.userId)).toEqual([]);
      };
      // Чужая организация: владелец Б не напомнит сотруднику А, владелец А — сотруднику Б.
      const fromB = await give(f.b.ownerUserId, CHAT.ownerB, acc.employeeId);
      await quiet(() => press(CHAT.ownerB, fromB.id, nudge(acc.employeeId)));
      const toB = await give(f.a.ownerUserId, CHAT.owner, accB.employeeId);
      await quiet(() => press(CHAT.owner, toB.id, nudge(accB.employeeId)));
      // Свой сотрудник у владельца Б напоминание получает: проверка выше — не «никому нельзя».
      const own = await give(f.b.ownerUserId, CHAT.ownerB, accB.employeeId);
      expect(await press(CHAT.ownerB, own.id, nudge(accB.employeeId))).toMatchObject({
        text: fill(TPL.tgActNudgeOk, { сотрудник: 'acc-b', n: 1 }),
      });
      expect(last(CHAT.accB).text).toContain('ОсОО «Чужая»');
      await f.t.admin.db
        .delete(schema.telegramOutbox)
        .where(eq(schema.telegramOutbox.userId, accB.userId));
      // Область «Свои» у «Отчетов для сдачи» — напомнить нельзя; без «Просматривать отчёты» — тоже.
      const chiefUser = person('chief-a').userId;
      const button = await give(chiefUser, CHAT.chief, acc.employeeId);
      await chiefScope('reports', 'own');
      await quiet(() => press(CHAT.chief, button.id, nudge(acc.employeeId)));
      await chiefScope('reports', 'all');
      await chiefRight('repView', false);
      await quiet(() => press(CHAT.chief, button.id, nudge(acc.employeeId)));
      await chiefRight('repView', true);
      // Сотрудник с областью «Свои» (бухгалтер) — тоже отказ, даже с кнопкой в чате.
      const mine = await give(acc.userId, CHAT.acc, person('hr-a').employeeId);
      await quiet(() => press(CHAT.acc, mine.id, nudge(person('hr-a').employeeId)));
      // С правом и областью «Все» та же кнопка работает.
      expect(await press(CHAT.chief, button.id, nudge(acc.employeeId))).toMatchObject({
        text: fill(TPL.tgActNudgeOk, { сотрудник: 'acc-a', n: 2 }),
      });
      clock.set('2026-10-19T03:00:00Z');
    });

    it('«Напомнить» входит в предел частоты нажатий', async () => {
      const hr = person('hr-a');
      const week = weekOwner;
      await f.t.admin.db
        .delete(schema.rateLimits)
        .where(eq(schema.rateLimits.kind, BOT_PRESS_RATE_LIMIT.kind));
      for (let i = 0; i < BOT_PRESS_RATE_LIMIT.max; i++) {
        await sendToBot(app, telegramPress(nudge(hr.employeeId), CHAT.owner, week.id));
      }
      expect(tg.answers.at(-1)).toMatchObject({
        text: fill(TPL.tgActNudgeNoTg, { сотрудник: 'hr-a', n: 1 }),
      });
      expect(await press(CHAT.owner, week.id, nudge(hr.employeeId))).toMatchObject({
        text: TPL.tgActFailed,
        alert: true,
      });
      await f.t.admin.db
        .delete(schema.rateLimits)
        .where(eq(schema.rateLimits.kind, BOT_PRESS_RATE_LIMIT.kind));
    });

    it('сводка недели: долги — только с правом и в своей области; «Напомнить» — только с областью «Все»; выключатели', async () => {
      const chief = person('chief-a').userId;
      const debtTitle = (m: BotMessage | null) =>
        (m?.tables ?? []).find((t) => t.title === TPL.tgSecDebt);
      const nudges = (m: BotMessage | null) =>
        (m?.buttons ?? []).flat().filter((b) => b.action === STAFF_BOT_NUDGE);
      const full = await weekOf(chief);
      expect(debtTitle(full)).toMatchObject({ n: 2 });
      expect(nudges(full)).toHaveLength(2);
      // Без права «Видеть плату за обслуживание» — раздела долгов и кнопок копирования нет.
      await chiefRight('fee', false);
      const noFee = await weekOf(chief);
      expect(debtTitle(noFee)).toBeUndefined();
      expect((noFee?.buttons ?? []).flat().some((b) => b.copy !== undefined)).toBe(false);
      await chiefRight('fee', true);
      // Область «Свои контрагенты»: чужих должников нет (своих должников у главного бухгалтера нет).
      await chiefScope('cps', 'own');
      expect(debtTitle(await weekOf(chief))).toBeUndefined();
      await chiefScope('cps', 'all');
      // Область «Свои» у отчётов: строки — только свои отчёты, кнопок «Напомнить» нет.
      await chiefScope('reports', 'own');
      const own = await weekOf(chief);
      expect(own?.tables?.[0]?.rows).toEqual([['chief-a', '1', '0', '0']]);
      expect(nudges(own)).toEqual([]);
      await chiefScope('reports', 'all');
      // «Плата за обслуживание» выключена — долгов нет ни у кого; подтверждение сдачи выключено — нет «Ждут».
      await settings({ features: { ...FEATURES, fee: false }, reportConfirm: false });
      const off = await weekOf(f.a.ownerUserId);
      expect(debtTitle(off)).toBeUndefined();
      expect(off?.tables?.[0]?.head).toEqual(['Сотрудник', 'Сдать', 'Просроч.']);
      await settings({ features: FEATURES, reportConfirm: true });
      // Не понедельник — сводки нет.
      clock.advance(24 * 3600_000);
      expect(await weekOf(f.a.ownerUserId)).toBeNull();
      clock.set('2026-10-19T03:00:00Z');
    });
  },
);
