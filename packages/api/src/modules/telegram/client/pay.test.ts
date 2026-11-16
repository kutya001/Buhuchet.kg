import { fixedClock, parseCron, type FakeTelegram } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  botPressData,
  CP_TG_ANSWER_ACTION,
  CP_TG_PAY_SENDS_PER_HOUR,
  CP_TG_QUESTIONS_PER_HOUR,
  CP_TG_REQ_PER_HOUR,
  fillTemplate,
  formatSomWithUnit,
  formatText,
  MONTH_PAY_SEND_MESSAGES,
  TELEGRAM_TEMPLATE_DEFAULTS,
  UI_TEXTS,
  type BotMessage,
} from '@buhuchet/domain';
import {
  ApiError,
  ContractorHistory,
  ContractorMonthPay,
  ContractorMonthPaySent,
  ContractorPage,
  ContractorTelegram,
  PublicPageTelegramLink,
  SentFileList,
} from '@buhuchet/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  apiRequest,
  createStaffFixture,
  linkTelegram,
  sendToBot,
  signIn,
  telegramPress,
  telegramUpdate,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../../../testing';
import { sendBotMessage } from '../bot';
import { contractorDebtJob } from './debt';
import { contractorPayJob } from './pay';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type Report = typeof schema.reports.$inferInsert;

const som = formatSomWithUnit;
/** M-Bank — код refDB.json. */
const MBANK = 'БНК-13';
/** Optima Bank — код refDB.json. */
const OPTIMA = 'БНК-14';
/**
 * Реквизит ответственного в сообщении клиенту (доработки 14.11.2026, блок 4; прототип v110 pgRqText):
 * блок «Реквизиты для перевода — сотрудника <ФИО>» и кнопка «Скопировать номер телефона» — только цифры.
 */
const REQUISITE_BLOCK = [
  'Реквизиты для перевода — сотрудника Сотрудник acc-a',
  'Перевод по номеру телефона: 0555 123 456',
  'Банки и кошельки: M-Bank',
  'Получатель: Бухгалтер А.',
].join('\n');
const COPY_PHONE = { text: TELEGRAM_TEMPLATE_DEFAULTS.tgBtnCpCopyPhone, copy: '0555123456' };
const CP_A = 'ОсОО «Ала-Тоо Трейд»';

/** Чаты сотрудников (привязаны к учётным записям) и чаты клиентов. */
const CHAT_ACC = 7001;
const CHAT_OWNER = 7002;
const CHAT_ACC_B = 7003;
const CHAT_HR = 7004;
const CHAT_SENIOR = 7005;
const CLIENT_1 = 9001;
const CLIENT_2 = 9002;
const CLIENT_B = 9003;
const STRANGER = 9099;

const PAID_HEADING = 'Контрагент сообщил об оплате';
const ASK_HEADING = 'Вопрос контрагента';
/** Конец шаблона `tgCpAskStaff`: ответ сотрудника на это сообщение уходит клиенту (прототип pgTgAnswer). */
const REPLY_HINT = 'Ответьте на это сообщение — ответ уйдёт клиенту.';
const ANSWER_HEADING = 'Ответ бухгалтера';

const SEP = '2026-09';
const TOTAL = 467_050;
/** На столько вырастает сумма патента между запусками задачи. */
const MORE = 10_000;

// Сегодня в тестах — 18.10.2026 (`createTestDeps`): до срока оплаты 20.10 — два дня.
describe.skipIf(!databaseAvailable())(
  '«К оплате» клиенту в Telegram (доработки 13.11.2026, К4; прототип v94)',
  () => {
    let f: Fixture;
    let tg: FakeTelegram;
    let owner: string;
    let chief: string;
    let acc: string;
    let senior: string;
    let ownerB: string;
    let cpA = '';
    let cpEmpty = '';
    let cpB = '';
    const ids: Record<string, string> = {};

    const employee = (login: string) => f.people[login]!.employeeId;
    const call = (
      cookie: string | undefined,
      method: 'GET' | 'POST' | 'PUT',
      path: string,
      body?: unknown,
    ) => apiRequest(f.app, method, path, cookie, body);
    const failure = async (res: Response) => ApiError.parse(await res.json()).error;
    const text = (
      key: keyof typeof TELEGRAM_TEMPLATE_DEFAULTS,
      values: Record<string, string | number> = {},
    ) => fillTemplate(TELEGRAM_TEMPLATE_DEFAULTS[key], values);

    const pay = async (cookie: string, cp: string, month = SEP) => {
      const res = await call(cookie, 'GET', `/api/contractors/${cp}/month-pay?month=${month}`);
      expect(res.status, await res.clone().text()).toBe(200);
      return ContractorMonthPay.parse(await res.json());
    };
    const send = (cookie: string | undefined, cp: string, month: unknown = SEP) =>
      call(cookie, 'POST', `/api/contractors/${cp}/month-pay/send`, { month });
    const sent = async (cookie: string, cp: string, month = SEP) => {
      const res = await send(cookie, cp, month);
      expect(res.status, await res.clone().text()).toBe(200);
      return ContractorMonthPaySent.parse(await res.json());
    };

    const features = (orgId: string, value: Record<string, boolean>) =>
      f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: value })
        .where(eq(schema.orgSettings.orgId, orgId));
    const ALL_ON = { cppage: true, telegram: true, taxpay: true, fee: true };
    const autoPay = (orgId: string, on: boolean) =>
      f.t.admin.db
        .update(schema.orgSettings)
        .set({ cpTgPay: on })
        .where(eq(schema.orgSettings.orgId, orgId));

    async function contractor(orgId: string, name: string, inn: string, responsible: string) {
      const [row] = await f.t.admin.db
        .insert(schema.contractors)
        .values({
          orgId,
          name,
          inn,
          phone: '+996505890076',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-01-15',
          responsibleEmployeeId: responsible,
        })
        .returning({ id: schema.contractors.id });
      return row!.id;
    }
    async function report(key: string, orgId: string, values: Omit<Report, 'orgId'>) {
      const [row] = await f.t.admin.db
        .insert(schema.reports)
        .values({ orgId, ...values })
        .returning({ id: schema.reports.id });
      ids[key] = row!.id;
    }

    /** Включить страницу, ввести код в «браузере», открыть ссылку на бота и подтвердить запрос. */
    async function linkClient(
      cookie: string,
      cp: string,
      inn: string,
      slug: string,
      chatId: number,
      name: string,
    ) {
      const page = await call(cookie, 'GET', `/api/contractors/${cp}/page`);
      let code = ContractorPage.parse(await page.json()).code;
      if (!code) {
        const on = await call(cookie, 'POST', `/api/contractors/${cp}/page/enable`);
        expect(on.status, await on.clone().text()).toBe(200);
        code = ContractorPage.parse(await on.json()).code;
      }
      const grant = await f.app.request(`/api/page/${slug}/${inn}/code`, {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      expect(grant.status, await grant.clone().text()).toBe(200);
      const link = await f.app.request(`/api/page/${slug}/${inn}/telegram`, {
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          cookie: (grant.headers.get('set-cookie') ?? '').split(';')[0]!,
        },
      });
      expect(link.status, await link.clone().text()).toBe(200);
      const token = new URL(PublicPageTelegramLink.parse(await link.json()).url).searchParams.get(
        'start',
      )!;
      await toBot(`/start ${token}`, chatId, name);
      const list = await call(cookie, 'GET', `/api/contractors/${cp}/page/telegram`);
      const row = ContractorTelegram.parse(await list.json()).items.find(
        (x) => x.status === 'wait',
      )!;
      const ok = await call(cookie, 'POST', `/api/contractors/${cp}/page/telegram/${row.id}`, {
        action: 'approve',
        version: row.version,
      });
      expect(ok.status, await ok.clone().text()).toBe(200);
      return row.id;
    }

    const toBot = async (
      body: string,
      chatId: number,
      username?: string,
      replyTo?: number,
    ): Promise<void> => {
      const update = telegramUpdate(body, chatId, { username });
      const res = await sendToBot(
        f.app,
        replyTo === undefined
          ? update
          : {
              ...update,
              message: { ...update.message, reply_to_message: { message_id: replyTo } },
            },
      );
      expect(res.status).toBe(200);
    };
    const press = async (data: string, chatId: number, messageId: number, fromId?: number) => {
      const res = await sendToBot(f.app, telegramPress(data, chatId, messageId, { fromId }));
      expect(res.status).toBe(200);
      return tg.answers.at(-1);
    };
    const sentTo = (chatId: number) => tg.sent.filter((m) => m.chatId === chatId);
    /** Номер последнего сообщения бота в чате (по нему приходит нажатие). */
    const lastMessageId = (chatId: number) => {
      const i = tg.sent.map((m) => m.chatId).lastIndexOf(chatId);
      return tg.messageIds[i]!;
    };
    const runJob = () => contractorPayJob.run(f.deps, f.deps.clock.now());
    const paidData = botPressData('cpPaid', SEP);
    const askData = botPressData('cpAsk', SEP);

    /** Строки истории контрагента о «К оплате» в Telegram — как они лежат в базе. */
    const history = async (contractorId: string) =>
      (
        await f.t.admin.db
          .select({
            action: schema.auditLog.action,
            userId: schema.auditLog.actorUserId,
            changes: schema.auditLog.changes,
          })
          .from(schema.auditLog)
          .where(
            and(
              eq(schema.auditLog.contractorId, contractorId),
              eq(schema.auditLog.entity, 'contractor_page'),
            ),
          )
          .orderBy(asc(schema.auditLog.at), asc(schema.auditLog.id))
      ).filter((h) =>
        ['page_tg_pay', 'page_tg_paid', 'page_tg_question', 'page_tg_answer'].includes(h.action),
      );
    const messages = (contractorId: string) =>
      f.t.admin.db
        .select()
        .from(schema.contractorTelegramMessages)
        .where(eq(schema.contractorTelegramMessages.contractorId, contractorId))
        .orderBy(
          asc(schema.contractorTelegramMessages.createdAt),
          asc(schema.contractorTelegramMessages.chatId),
        );
    /** Начать тест с чистого листа: без сообщений клиентам, записей истории о них и счётчиков. */
    const wipe = async () => {
      await f.t.admin.db.delete(schema.contractorPayClaims);
      await f.t.admin.db.delete(schema.contractorTelegramMessages);
      await f.t.admin.db.execute(
        sql`delete from audit_log where action in ('page_tg_pay', 'page_tg_paid', 'page_tg_question', 'page_tg_answer')`,
      );
      await f.t.admin.db.execute(
        sql`delete from rate_limits where kind in ('cp_tg_ask', 'cp_tg_req')`,
      );
      await f.t.admin.db.delete(schema.telegramOutbox);
      tg.sent.length = 0;
      tg.messageIds.length = 0;
      tg.answers.length = 0;
      tg.edits.length = 0;
    };

    beforeAll(async () => {
      f = await createStaffFixture();
      tg = f.deps.telegram as FakeTelegram;
      await seedAllPlatformDictionaries(f.t.admin.db);
      await features(f.a.orgId, ALL_ON);
      await features(f.b.orgId, ALL_ON);
      // Само «К оплате» — в каждый день «за 5» … «за 1» до срока в 09:00 по Бишкеку: в это время
      // стоят часы тестов (воскресенье 18.10.2026, срок оплаты — 20.10).
      await f.t.admin.db.insert(schema.orgTelegramNotices).values(
        [f.a.orgId, f.b.orgId].map((orgId) => ({
          orgId,
          code: 'cp_pay' as const,
          days: [5, 4, 3, 2, 1],
          atTime: '09:00',
        })),
      );
      // «Старший» видит всех контрагентов, но ни отчётов, ни права «Управлять страницей» у него нет.
      await f.t.admin.db
        .update(schema.roleScopes)
        .set({ scope: 'all' })
        .where(eq(schema.roleScopes.roleId, f.roleIds.senior));
      [owner, chief, acc, senior, ownerB] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'chief-a', TEST_PASSWORD),
        signIn(f.app, 'acc-a', TEST_PASSWORD),
        signIn(f.app, 'senior-a', TEST_PASSWORD),
        signIn(f.app, 'owner-b', TEST_PASSWORD),
      ]);
      const accB = await signIn(f.app, 'acc-b', TEST_PASSWORD);
      for (const cookie of [owner, ownerB]) {
        const res = await call(cookie, 'POST', '/api/org-report-types/connect', {
          connect: ['nds', 'pat', 'utli'],
          disconnect: [],
        });
        expect(res.status, await res.clone().text()).toBe(200);
      }
      cpA = await contractor(
        f.a.orgId,
        'ОсОО «Ала-Тоо Трейд»',
        '03744097401851',
        employee('acc-a'),
      );
      cpEmpty = await contractor(f.a.orgId, 'ИП Садыков', '20101199000123', employee('chief-a'));
      cpB = await contractor(f.b.orgId, 'ОсОО «Бишкек»', '03744097401852', employee('acc-b'));
      // Реквизит ответственного бухгалтера: контрагент по умолчанию переводит деньги сотруднику.
      const wallet = await call(acc, 'POST', '/api/profile/wallets', {
        kind: 'phone',
        bankCode: null,
        accountNo: null,
        phone: '+996555123456',
        phoneBanks: [MBANK],
        holderName: 'Бухгалтер А.',
        isMain: true,
      });
      expect(wallet.status, await wallet.clone().text()).toBeLessThan(300);
      // У бухгалтера организации Б — тоже: без реквизитов «К оплате» не уходит (блок 4 доработок 14.11).
      const walletB = await call(accB, 'POST', '/api/profile/wallets', {
        kind: 'phone',
        bankCode: null,
        accountNo: null,
        phone: '+996555765432',
        phoneBanks: [MBANK],
        holderName: 'Бухгалтер Б.',
        isMain: true,
      });
      expect(walletB.status, await walletB.clone().text()).toBeLessThan(300);

      const sep = { period: 'M' as const, periodStart: '2026-09-01' };
      const mine = { contractorId: cpA, responsibleEmployeeId: employee('acc-a'), ...sep };
      // НДС за сентябрь: оплачен частично, срок оплаты позже патента.
      await report('nds', f.a.orgId, {
        ...mine,
        reportTypeCode: 'nds',
        act: 'both',
        dueBase: '2026-10-20',
        dueDate: '2026-10-20',
        payDue: '2026-10-25',
        amount: 500_000,
        paid: 120_000,
      });
      // Патент за сентябрь: только уплата, не оплачен.
      await report('pat', f.a.orgId, {
        ...mine,
        reportTypeCode: 'pat',
        act: 'pay',
        dueBase: '2026-10-20',
        dueDate: '2026-10-20',
        payDue: '2026-10-20',
        amount: 87_050,
      });
      await report('ndsB', f.b.orgId, {
        contractorId: cpB,
        responsibleEmployeeId: employee('acc-b'),
        ...sep,
        reportTypeCode: 'nds',
        act: 'both',
        dueBase: '2026-10-20',
        dueDate: '2026-10-20',
        payDue: '2026-10-20',
        amount: 250_000,
      });

      await linkTelegram(f.app, acc, CHAT_ACC, 'acc_a');
      await linkTelegram(f.app, owner, CHAT_OWNER, 'owner_a');
      await linkTelegram(f.app, accB, CHAT_ACC_B, 'acc_b');
      await linkClient(owner, cpA, '03744097401851', 'org-a', CLIENT_1, 'client_one');
      await linkClient(owner, cpA, '03744097401851', 'org-a', CLIENT_2, 'client_two');
      await linkClient(ownerB, cpB, '03744097401852', 'org-b', CLIENT_B, 'client_b');
    });

    beforeEach(async () => {
      await wipe();
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('карточка: «Отправить в Telegram» — число получателей и что мешает', async () => {
      expect((await pay(owner, cpA)).send).toEqual({ refusal: null, recipients: 2, params: null });
      expect((await pay(chief, cpA)).send).toEqual({ refusal: null, recipients: 2, params: null });
      // Бухгалтер: права «Управлять страницей контрагента» нет.
      expect((await pay(acc, cpA)).send).toEqual({
        refusal: 'month_pay_send_right',
        recipients: 2,
        params: null,
      });
      // Никто не подключил Telegram.
      expect((await pay(owner, cpEmpty)).send).toEqual({
        refusal: 'month_pay_send_not_linked',
        recipients: 0,
        params: null,
      });
      // Контрагент в архиве — раньше, чем «не подключил».
      await f.t.admin.db
        .update(schema.contractors)
        .set({ serviceStatus: 'archived' })
        .where(eq(schema.contractors.id, cpEmpty));
      expect((await pay(owner, cpEmpty)).send?.refusal).toBe('month_pay_send_archived');
      await f.t.admin.db
        .update(schema.contractors)
        .set({ serviceStatus: 'active' })
        .where(eq(schema.contractors.id, cpEmpty));
      // Без «Напоминаний в Telegram» или «Страницы контрагента по ссылке» кнопки нет.
      const offs: Record<string, boolean>[] = [
        { cppage: true, taxpay: true },
        { telegram: true, taxpay: true },
      ];
      for (const off of offs) {
        await features(f.a.orgId, off);
        expect((await pay(owner, cpA)).send).toBeNull();
        const res = await send(owner, cpA);
        expect(res.status).toBe(409);
        expect((await failure(res)).code).toBe('month_pay_send_off');
      }
      await features(f.a.orgId, ALL_ON);
      expect(tg.sent).toEqual([]);
    });

    it('раздел «Telegram» страницы скрыт у контрагента — получателей нет', async () => {
      const page = ContractorPage.parse(
        await (await call(owner, 'GET', `/api/contractors/${cpA}/page`)).json(),
      );
      const hidden = await call(owner, 'PUT', `/api/contractors/${cpA}/page/sections`, {
        hiddenSections: ['tg'],
        version: page.version,
      });
      expect(hidden.status, await hidden.clone().text()).toBe(200);
      try {
        expect((await pay(owner, cpA)).send).toEqual({
          refusal: 'month_pay_send_not_linked',
          recipients: 0,
          params: null,
        });
        const res = await send(owner, cpA);
        expect(res.status).toBe(409);
        expect((await failure(res)).code).toBe('month_pay_send_not_linked');
        expect(tg.sent).toEqual([]);
      } finally {
        const shown = await call(owner, 'PUT', `/api/contractors/${cpA}/page/sections`, {
          hiddenSections: [],
          version: ContractorPage.parse(await hidden.json()).version,
        });
        expect(shown.status).toBe(200);
      }
    });

    it('отправка: вход, право, область, чужая организация, неверный месяц', async () => {
      expect((await send(undefined, cpA)).status).toBe(401);
      // Чужая организация и контрагент вне области — «не найден».
      expect((await send(ownerB, cpA)).status).toBe(404);
      expect((await send(owner, cpB)).status).toBe(404);
      expect((await send(acc, cpEmpty)).status).toBe(404);
      // «Старший»: контрагентов видит, отчётов — нет.
      expect((await send(senior, cpA)).status).toBe(403);
      // Бухгалтер видит всё, но права «Управлять страницей контрагента» у него нет.
      const noRight = await send(acc, cpA);
      expect(noRight.status).toBe(403);
      expect(await failure(noRight)).toMatchObject({
        code: 'month_pay_send_right',
        message: 'Нужно право «Управлять страницей контрагента»',
      });
      for (const month of ['2026-13', '09.2026', '', null, 202609]) {
        expect((await send(owner, cpA, month)).status).toBe(400);
      }
      expect((await send(owner, 'не-номер')).status).toBe(400);
      // Платить нечего.
      const empty = await send(owner, cpA, '2026-08');
      expect(empty.status).toBe(409);
      expect((await failure(empty)).code).toBe('month_pay_empty');
      // Изменяющий запрос без Origin нашего сайта не проходит.
      const foreign = await f.app.request(`/api/contractors/${cpA}/month-pay/send`, {
        method: 'POST',
        headers: {
          cookie: owner,
          origin: 'https://evil.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ month: SEP }),
      });
      expect(foreign.status).toBe(403);
      expect(tg.sent).toEqual([]);
      expect(await messages(cpA)).toEqual([]);
      expect(await history(cpA)).toEqual([]);
    });

    it('отправка: сообщение с таблицей и кнопками каждому подключённому, запись в истории', async () => {
      const before = await pay(chief, cpA);
      const res = await send(chief, cpA);
      expect(res.status, await res.clone().text()).toBe(200);
      const raw = await res.text();
      expect(ContractorMonthPaySent.parse(JSON.parse(raw))).toEqual({
        recipients: 2,
        delivered: 2,
      });
      // Реквизит ответственного сотрудника в ответ отправителю не попадает — только в чат клиента.
      expect(raw).not.toContain('0555');

      expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_1, CLIENT_2]);
      const [first] = tg.sent;
      const [patName, ndsName] = before.rows.map((x) => x.name);
      expect(first!.text).toContain('Налоги к оплате до 20.10.2026');
      expect(first!.text).toContain('ОсОО «Ала-Тоо Трейд» · бухгалтер acc-a');
      expect(first!.text).toContain(
        text('tgCpPay', {
          контрагент: 'ОсОО «Ала-Тоо Трейд»',
          месяц: 'сентябрь 2026',
          сумма: som(TOTAL),
          срок: '20.10.2026',
        }),
      );
      for (const part of [patName!, ndsName!, '870,50', '3 800,00', '4 670,50', '20.10', '25.10']) {
        expect(first!.text.replace(/\s/g, ' ')).toContain(part);
      }
      // Под текстом — реквизиты ответственного блоком «Реквизиты для перевода — …».
      expect(first!.text).toContain(REQUISITE_BLOCK);
      // Чужих контрагентов и организаций в сообщении нет.
      expect(first!.text).not.toContain('Садыков');
      expect(first!.text).not.toContain('Бишкек');
      expect(first!.options?.keyboard).toEqual([
        [COPY_PHONE],
        [
          { text: text('tgBtnCpPaid'), data: paidData },
          { text: text('tgBtnCpQ'), data: askData },
        ],
      ]);

      const rows = await messages(cpA);
      expect(
        rows.map((r) => [r.chatId, r.kind, r.month, r.total, r.auto, r.attempts, r.sentBy]),
      ).toEqual([
        [CLIENT_1, 'pay', SEP, TOTAL, false, 1, f.people['chief-a']!.userId],
        [CLIENT_2, 'pay', SEP, TOTAL, false, 1, f.people['chief-a']!.userId],
      ]);
      expect(rows.map((r) => r.messageId)).toEqual(tg.messageIds);
      expect(rows.every((r) => r.orgId === f.a.orgId)).toBe(true);
      expect(await history(cpA)).toEqual([
        {
          action: 'page_tg_pay',
          userId: f.people['chief-a']!.userId,
          changes: [{ field: 'tgPay', to: { month: SEP, total: TOTAL, recipients: 2 } }],
        },
      ]);
    });

    it('запись истории с суммой видна только тому, кто видит отчёты контрагента', async () => {
      await sent(owner, cpA);
      const lines = async (cookie: string) => {
        const res = await call(cookie, 'GET', `/api/contractors/${cpA}/history`);
        expect(res.status, await res.clone().text()).toBe(200);
        return ContractorHistory.parse(await res.json()).items.filter(
          (h) => h.action === 'page_tg_pay',
        );
      };
      expect(await lines(owner)).toHaveLength(1);
      expect(await lines(acc)).toHaveLength(1);
      // «Старший»: контрагента видит, отчётов (и сумм) — нет.
      expect(await lines(senior)).toEqual([]);
    });

    it('Telegram не принял сообщения — 409, записи в истории нет; принял часть — отправлено части', async () => {
      const blocked = {
        ok: false as const,
        errorCode: 403,
        description: 'bot was blocked',
        permanent: true,
      };
      tg.failNext(blocked, blocked);
      const res = await send(owner, cpA);
      expect(res.status).toBe(409);
      expect(await failure(res)).toMatchObject({
        code: 'month_pay_send_failed',
        message: 'Не удалось отправить сообщение в Telegram. Попробуйте позже',
      });
      expect(await history(cpA)).toEqual([]);
      expect((await messages(cpA)).map((r) => [r.messageId, r.attempts])).toEqual([
        [null, 1],
        [null, 1],
      ]);

      tg.failNext(blocked);
      expect(await sent(owner, cpA)).toEqual({ recipients: 2, delivered: 1 });
      expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_2]);
      expect((await history(cpA)).map((h) => h.changes)).toEqual([
        [{ field: 'tgPay', to: { month: SEP, total: TOTAL, recipients: 1 } }],
      ]);
    });

    it('клиента не завалить: не больше 10 отправок в час одному контрагенту', async () => {
      for (let i = 0; i < CP_TG_PAY_SENDS_PER_HOUR; i++) await sent(owner, cpA);
      const res = await send(owner, cpA);
      expect(res.status).toBe(429);
      expect((await failure(res)).code).toBe('month_pay_send_limit');
      expect(tg.sent).toHaveLength(CP_TG_PAY_SENDS_PER_HOUR * 2);
      // Предел — на контрагента: другой организации он не мешает.
      expect(await sent(ownerB, cpB)).toEqual({ recipients: 1, delivered: 1 });
      // У «К оплате» организации Б — реквизит её бухгалтера, реквизитов организации А нет.
      const b = sentTo(CLIENT_B).at(-1)!;
      expect(b.text).toContain('Получатель: Бухгалтер Б.');
      expect(b.text).toContain('0555 765 432');
      expect(b.text).not.toContain('Организация А');
      expect(b.text).not.toContain('0555 123 456');
      expect(b.options?.keyboard).toContainEqual([{ ...COPY_PHONE, copy: '0555765432' }]);
    });

    it('«Оплатил»: запись в историю, сообщение ответственному, кнопка гаснет; второй раз — «устарела»', async () => {
      await sent(owner, cpA);
      const messageId = tg.messageIds[0]!;
      tg.sent.length = 0;
      tg.messageIds.length = 0;

      const answer = await press(paidData, CLIENT_1, messageId);
      expect(answer).toMatchObject({ text: text('tgCpPaidOk'), alert: false });
      expect(tg.edits).toEqual([
        {
          chatId: CLIENT_1,
          messageId,
          keyboard: [
            [COPY_PHONE],
            [
              { text: '✓ Сообщили бухгалтеру', data: 'off', disabled: true },
              { text: text('tgBtnCpQ'), data: askData },
            ],
          ],
        },
      ]);
      expect((await history(cpA)).slice(1)).toEqual([
        {
          action: 'page_tg_paid',
          userId: null,
          changes: [{ field: 'tgPaid', to: { month: SEP, total: TOTAL, name: '@client_one' } }],
        },
      ]);
      // Ответственному бухгалтеру — сообщение; владельцу и второму клиенту — ничего.
      expect(tg.sent.map((m) => [m.chatId, m.text])).toEqual([
        [
          CHAT_ACC,
          `${PAID_HEADING}\n${text('tgCpPaidStaff', {
            контрагент: 'ОсОО «Ала-Тоо Трейд»',
            телеграм: '@client_one',
            месяц: 'сентябрь 2026',
            сумма: som(TOTAL),
          })}`,
        ],
      ]);

      // Второе нажатие и повтор от Telegram ничего не меняют.
      const again = await press(paidData, CLIENT_1, messageId);
      expect(again).toMatchObject({ text: text('tgActStale'), alert: true });
      expect(await history(cpA)).toHaveLength(2);
      expect(tg.sent).toHaveLength(1);
    });

    it('«Оплатил», когда клиент может отправлять файлы: бот предлагает прислать чек; чек — к сообщению «ждёт подтверждения» (п. 4 блока 4, этап 2)', async () => {
      await features(f.a.orgId, { ...ALL_ON, files: true });
      try {
        await sent(owner, cpA);
        const messageId = tg.messageIds[0]!;
        tg.sent.length = 0;
        tg.messageIds.length = 0;
        expect(await press(paidData, CLIENT_1, messageId)).toMatchObject({
          text: text('tgCpPaidOk'),
        });
        const [payRow] = (await messages(cpA)).filter(
          (m) => m.kind === 'pay' && m.chatId === CLIENT_1,
        );
        // Предложение — клиенту, нажавшему «Оплатил»: в кнопке — номер оплаченного сообщения.
        const receiptData = botPressData('cpReceipt', `tax.${payRow!.id}`);
        expect(sentTo(CLIENT_1).map((m) => [m.text, m.options.keyboard])).toEqual([
          [text('tgCpReceiptOffer'), [[{ text: text('tgBtnCpReceipt'), data: receiptData }]]],
        ]);
        const offerId = lastMessageId(CLIENT_1);
        expect(await press(receiptData, CLIENT_1, offerId)).toMatchObject({ text: undefined });
        expect(sentTo(CLIENT_1).at(-1)).toMatchObject({
          text: text('tgCpReceiptAsk'),
          options: { keyboard: [[{ text: text('tgBtnCancel'), data: 'askCancel' }]] },
        });
        const askId = lastMessageId(CLIENT_1);
        tg.files.set('pay-receipt', new TextEncoder().encode('%PDF-1.7\nчек'));
        const res = await sendToBot(
          f.app,
          telegramUpdate(null, CLIENT_1, {
            replyTo: askId,
            document: { fileId: 'pay-receipt', name: 'Чек.pdf', size: 12 },
          }),
        );
        expect(res.status).toBe(200);
        expect(sentTo(CLIENT_1).at(-1)!.text).toBe(text('tgCpReceiptOk'));
        const [file] = await f.t.admin.db
          .select()
          .from(schema.contractorSentFiles)
          .where(eq(schema.contractorSentFiles.contractorId, cpA));
        expect(file).toMatchObject({
          source: 'telegram',
          name: 'Чек.pdf',
          senderName: '@client_one',
          tgChatId: CLIENT_1,
          comment: 'Чек к «К оплате» за сентябрь 2026',
          status: 'new',
        });
        // Чек стал чеком того же «Оплатил»: второго сообщения об оплате нет.
        expect(
          await f.t.admin.db
            .select({
              purpose: schema.contractorPayClaims.purpose,
              month: schema.contractorPayClaims.month,
              amount: schema.contractorPayClaims.amount,
              sentFileId: schema.contractorPayClaims.sentFileId,
              tgMessageId: schema.contractorPayClaims.tgMessageId,
              status: schema.contractorPayClaims.status,
            })
            .from(schema.contractorPayClaims)
            .where(eq(schema.contractorPayClaims.contractorId, cpA)),
        ).toEqual([
          {
            purpose: 'tax',
            month: SEP,
            amount: TOTAL,
            sentFileId: file!.id,
            tgMessageId: payRow!.id,
            status: 'wait',
          },
        ]);
        // «Прислать чек» под предложением погасла с подписью, «Отмена» под просьбой — тоже.
        expect(tg.edits.slice(-2)).toEqual([
          {
            chatId: CLIENT_1,
            messageId: askId,
            keyboard: [[{ text: text('tgBtnCancel'), data: 'off', disabled: true }]],
          },
          {
            chatId: CLIENT_1,
            messageId: offerId,
            keyboard: [[{ text: '✓ Чек отправлен', data: 'off', disabled: true }]],
          },
        ]);
        // У чека — что оплачено: «Принять» откроет «Принять деньги» за сентябрь с суммой сообщения.
        const listed = await call(owner, 'GET', `/api/contractors/${cpA}/sent-files`);
        expect(listed.status, await listed.clone().text()).toBe(200);
        const item = SentFileList.parse(await listed.json()).items.find((x) => x.id === file!.id);
        expect(item!.pay).toEqual({
          purpose: 'tax',
          month: SEP,
          amount: TOTAL,
          source: 'telegram',
        });
      } finally {
        await f.t.admin.db.delete(schema.contractorPayClaims);
        await f.t.admin.db.delete(schema.contractorSentFiles);
        await features(f.a.orgId, ALL_ON);
      }
    });

    it('нажатие сверяется с записью бота: чужой чат, подделанные данные, отключённый Telegram', async () => {
      await sent(owner, cpA);
      await sent(ownerB, cpB);
      const [m1, m2, mB] = tg.messageIds as [number, number, number];
      const quiet = async () => {
        expect((await history(cpA)).filter((h) => h.action !== 'page_tg_pay')).toEqual([]);
        expect((await history(cpB)).filter((h) => h.action !== 'page_tg_pay')).toEqual([]);
        expect(tg.edits).toEqual([]);
      };

      // Сообщение одного чата из другого чата не нажать — ни своей организации, ни чужой.
      for (const [chat, message] of [
        [CLIENT_2, m1],
        [CLIENT_B, m1],
        [CLIENT_1, mB],
        [STRANGER, m2],
        [CHAT_OWNER, m1],
      ] as const) {
        const a = await press(paidData, chat, message);
        expect(a?.text).not.toBe(text('tgCpPaidOk'));
      }
      await quiet();
      // Нажал не хозяин чата (сообщение переслано в группу) и нажатие в группе.
      await press(paidData, CLIENT_1, m1, CLIENT_2);
      const group = await sendToBot(
        f.app,
        telegramPress(paidData, CLIENT_1, m1, { chatType: 'group' }),
      );
      expect(group.status).toBe(200);
      await quiet();
      // Данные кнопки подделаны: другого месяца и другого действия в сообщении нет.
      for (const data of [
        botPressData('cpPaid', '2026-08'),
        botPressData('cpPaid'),
        botPressData('cptgOk', SEP),
        'cpPaid:2026-09:x',
        '',
      ]) {
        const a = await press(data, CLIENT_1, m1);
        expect(a).toMatchObject({ alert: true });
        expect(a?.text).not.toBe(text('tgCpPaidOk'));
      }
      await quiet();

      // Telegram отключён сотрудником — кнопки больше не работают.
      const list = ContractorTelegram.parse(
        await (await call(owner, 'GET', `/api/contractors/${cpA}/page/telegram`)).json(),
      );
      const row = list.items.find((x) => x.name === '@client_two')!;
      const off = await call(owner, 'POST', `/api/contractors/${cpA}/page/telegram/${row.id}`, {
        action: 'unlink',
        version: row.version,
      });
      expect(off.status, await off.clone().text()).toBe(200);
      try {
        for (const data of [paidData, askData]) {
          expect(await press(data, CLIENT_2, m2)).toMatchObject({
            text: text('tgCpNotLinked'),
            alert: true,
          });
        }
        await quiet();
        expect((await pay(owner, cpA)).send?.recipients).toBe(1);
      } finally {
        await f.t.admin.db
          .update(schema.contractorTelegramLinks)
          .set({ status: 'on' })
          .where(eq(schema.contractorTelegramLinks.id, row.id));
      }
    });

    it('кнопки и вопросы не работают, когда раздел «Telegram» страницы скрыт или функция выключена', async () => {
      await sent(owner, cpA);
      const [m1] = tg.messageIds as [number];
      const hide = (hiddenSections: ('tg' | 'pay')[]) =>
        f.t.admin.db
          .update(schema.contractorPages)
          .set({ hiddenSections })
          .where(eq(schema.contractorPages.contractorId, cpA));
      // Клиент успел нажать «Вопрос бухгалтеру»: бот ждёт вопрос ответом на свою просьбу.
      await press(askData, CLIENT_1, m1);
      const askId = lastMessageId(CLIENT_1);
      const refused = async () => {
        for (const data of [paidData, askData]) {
          expect(await press(data, CLIENT_1, m1)).toMatchObject({
            text: text('tgCpNotLinked'),
            alert: true,
          });
        }
        // Вопрос ответом на просьбу не принимается: клиенту — «не подключён», бухгалтеру — ничего.
        await toBot('Можно оплатить позже?', CLIENT_1, 'client_one', askId);
        expect(sentTo(CLIENT_1).at(-1)!.text).toBe(text('tgCpNotLinked'));
        expect((await history(cpA)).filter((h) => h.action !== 'page_tg_pay')).toEqual([]);
        expect(tg.edits).toEqual([]);
        expect(sentTo(CHAT_ACC)).toEqual([]);
      };
      try {
        await hide(['tg']);
        await refused();
        await hide([]);
        await features(f.a.orgId, { cppage: true, taxpay: true, fee: true });
        await refused();
        await features(f.a.orgId, { telegram: true, taxpay: true, fee: true });
        await refused();
      } finally {
        await hide([]);
        await features(f.a.orgId, ALL_ON);
      }
      // Раздел снова показан — кнопка работает.
      expect(await press(paidData, CLIENT_1, m1)).toMatchObject({ text: text('tgCpPaidOk') });
    });

    /** Поля контрагента для теста реквизитов: кому переводит деньги на налоги и ответственный. */
    const setContractor = (
      cp: string,
      values: Partial<
        Pick<typeof schema.contractors.$inferInsert, 'paysTo' | 'responsibleEmployeeId'>
      >,
    ) => f.t.admin.db.update(schema.contractors).set(values).where(eq(schema.contractors.id, cp));
    const hidePage = (cp: string, sections: string[]) =>
      f.t.admin.db
        .update(schema.contractorPages)
        .set({ hiddenSections: sections })
        .where(eq(schema.contractorPages.contractorId, cp));
    /** Основной счёт организации для налогов (расчётный счёт с БИК). */
    const TAX_ACCOUNT = {
      kind: 'acc',
      bankCode: OPTIMA,
      accountNo: '1091820004567012',
      bik: '109018',
      phone: null,
      phoneBanks: [],
      holderName: 'Организация А',
      purpose: 'tax',
      mainTax: true,
      mainFee: false,
    };
    const TAX_ACCOUNT_LINES = [
      'Банк: Optima Bank',
      'Счёт: 1091820004567012',
      'БИК: 109018',
      'Получатель: Организация А',
    ];

    it('без реквизитов для перевода «К оплате» не уходит: «Как оплатить» скрыт, нет счёта организации или реквизита сотрудника', async () => {
      const refused = async (code: string, params: { contractor: string; employee: string }) => {
        expect((await pay(owner, cpA)).send).toEqual({ refusal: code, recipients: 2, params });
        const res = await send(owner, cpA);
        expect(res.status).toBe(409);
        expect(await failure(res)).toEqual({
          code,
          message: formatText(
            MONTH_PAY_SEND_MESSAGES[code as keyof typeof MONTH_PAY_SEND_MESSAGES],
            params,
          ),
          details: params,
        });
      };
      const params = { contractor: CP_A, employee: 'acc-a' };
      // Раздел «Как оплатить» скрыт: реквизиты в Telegram не уходят, а без них — и само «К оплате».
      await hidePage(cpA, ['pay']);
      try {
        await refused('month_pay_send_req_hidden', params);
      } finally {
        await hidePage(cpA, []);
      }
      // Деньги на налоги переводят организации, а основного счёта для налогов нет.
      await setContractor(cpA, { paysTo: 'org' });
      try {
        await refused('month_pay_send_no_req_org', params);
        // Счёт добавлен — «К оплате» уходит с реквизитами организации и кнопкой «Скопировать
        // реквизиты для перевода»: банк, счёт, БИК и получатель.
        const account = await call(owner, 'POST', '/api/org/accounts', TAX_ACCOUNT);
        expect(account.status, await account.clone().text()).toBe(200);
        expect((await pay(owner, cpA)).send).toEqual({
          refusal: null,
          recipients: 2,
          params: null,
        });
        expect(await sent(owner, cpA)).toEqual({ recipients: 2, delivered: 2 });
        expect(tg.sent[0]!.text).toContain(
          ['Реквизиты для перевода — организации Организация А', ...TAX_ACCOUNT_LINES].join('\n'),
        );
        expect(tg.sent[0]!.options?.keyboard?.[0]).toEqual([
          { text: text('tgBtnCpCopyReq'), copy: TAX_ACCOUNT_LINES.join('\n') },
        ]);
      } finally {
        await setContractor(cpA, { paysTo: 'emp' });
        await f.t.admin.db
          .delete(schema.orgAccounts)
          .where(eq(schema.orgAccounts.orgId, f.a.orgId));
      }
      await wipe();
      // У ответственного сотрудника нет реквизитов: подсказка — кто их добавляет.
      await setContractor(cpA, { responsibleEmployeeId: employee('chief-a') });
      try {
        await refused('month_pay_send_no_req_emp', { contractor: CP_A, employee: 'chief-a' });
      } finally {
        await setContractor(cpA, { responsibleEmployeeId: employee('acc-a') });
      }
      expect(tg.sent).toEqual([]);
      expect(await messages(cpA)).toEqual([]);
      expect(await history(cpA)).toEqual([]);
    });

    it('«Вопрос бухгалтеру»: бот просит написать вопрос, вопрос уходит ответственному и в историю', async () => {
      await sent(owner, cpA);
      const messageId = tg.messageIds[0]!;
      tg.sent.length = 0;
      tg.messageIds.length = 0;

      await press(askData, CLIENT_1, messageId);
      expect(sentTo(CLIENT_1).map((m) => m.text)).toEqual([text('tgCpAskHow')]);
      const askId = lastMessageId(CLIENT_1);
      // Второе нажатие новую просьбу не создаёт — бот повторяет подсказку.
      expect(await press(askData, CLIENT_1, messageId)).toMatchObject({
        text: text('tgCpAskHow'),
      });
      expect(sentTo(CLIENT_1)).toHaveLength(1);
      // Кнопка вопроса не гаснет: спросить можно ещё раз.
      expect(tg.edits).toEqual([]);

      const question = 'Можно оплатить  частями?\nДо 25 числа';
      await toBot(question, CLIENT_1, 'client_one', askId);
      expect(sentTo(CLIENT_1).map((m) => m.text)).toEqual([
        text('tgCpAskHow'),
        text('tgCpAskSent'),
      ]);
      expect(sentTo(CHAT_ACC).map((m) => m.text)).toEqual([
        `${ASK_HEADING}\nОсОО «Ала-Тоо Трейд»: вопрос от «@client_one». Можно оплатить частями? До 25 числа ${REPLY_HINT}`,
      ]);
      expect(sentTo(CHAT_OWNER)).toEqual([]);
      expect(sentTo(CLIENT_2)).toEqual([]);
      expect((await history(cpA)).slice(1)).toEqual([
        {
          action: 'page_tg_question',
          userId: null,
          changes: [
            {
              field: 'tgQuestion',
              to: { name: '@client_one', text: 'Можно оплатить частями? До 25 числа' },
            },
          ],
        },
      ]);

      // Ответ на ту же просьбу второй раз вопросом не считается.
      await toBot('И ещё вопрос', CLIENT_1, 'client_one', askId);
      expect(await history(cpA)).toHaveLength(2);
      expect(sentTo(CHAT_ACC)).toHaveLength(1);

      // Новая просьба — и текст без ответа на сообщение тоже принимается.
      await press(askData, CLIENT_1, messageId);
      await toBot('Какой КБК у патента?', CLIENT_1, 'client_one');
      expect(await history(cpA)).toHaveLength(3);
      expect(sentTo(CHAT_ACC)).toHaveLength(2);
    });

    it('вопрос принимается только в своём чате и только по открытой просьбе', async () => {
      await sent(owner, cpA);
      await sent(ownerB, cpB);
      const [m1, , mB] = tg.messageIds as [number, number, number];
      await press(askData, CLIENT_1, m1);
      const askId = lastMessageId(CLIENT_1);
      const staffBefore = sentTo(CHAT_ACC).length;

      // Ответ на чужую просьбу из другого чата, текст без просьбы — не вопрос.
      await toBot('Чужой вопрос', CLIENT_2, 'client_two', askId);
      await toBot('Чужой вопрос', CLIENT_B, 'client_b', askId);
      await toBot('Чужой вопрос', STRANGER, 'stranger', askId);
      await toBot('Просто текст', CLIENT_2, 'client_two');
      await toBot('Просто текст', CLIENT_B, 'client_b');
      expect((await history(cpA)).filter((h) => h.action === 'page_tg_question')).toEqual([]);
      expect((await history(cpB)).filter((h) => h.action === 'page_tg_question')).toEqual([]);
      expect(sentTo(CHAT_ACC)).toHaveLength(staffBefore);

      // Вопрос клиента организации Б уходит её бухгалтеру, организация А его не видит.
      await press(askData, CLIENT_B, mB);
      await toBot('Вопрос организации Б', CLIENT_B, 'client_b', lastMessageId(CLIENT_B));
      expect(sentTo(CHAT_ACC_B).map((m) => m.text)).toEqual([
        `${ASK_HEADING}\nОсОО «Бишкек»: вопрос от «@client_b». Вопрос организации Б ${REPLY_HINT}`,
      ]);
      expect(sentTo(CHAT_ACC)).toHaveLength(staffBefore);
      expect(sentTo(CHAT_OWNER)).toEqual([]);
      expect((await history(cpA)).filter((h) => h.action === 'page_tg_question')).toEqual([]);
      expect((await history(cpB)).filter((h) => h.action === 'page_tg_question')).toHaveLength(1);
    });

    it('вопросов из одного подключения — не больше 10 в час', async () => {
      await sent(owner, cpA);
      const messageId = tg.messageIds[0]!;
      for (let i = 0; i < CP_TG_QUESTIONS_PER_HOUR; i++) {
        await press(askData, CLIENT_1, messageId);
        await toBot(`Вопрос ${i + 1}`, CLIENT_1, 'client_one', lastMessageId(CLIENT_1));
      }
      expect((await history(cpA)).filter((h) => h.action === 'page_tg_question')).toHaveLength(
        CP_TG_QUESTIONS_PER_HOUR,
      );
      await press(askData, CLIENT_1, messageId);
      await toBot('Ещё один', CLIENT_1, 'client_one', lastMessageId(CLIENT_1));
      expect(sentTo(CLIENT_1).at(-1)!.text).toBe(
        'Слишком много вопросов за час. Позвоните вашему бухгалтеру или напишите позже.',
      );
      expect((await history(cpA)).filter((h) => h.action === 'page_tg_question')).toHaveLength(
        CP_TG_QUESTIONS_PER_HOUR,
      );
      expect(sentTo(CHAT_ACC)).toHaveLength(CP_TG_QUESTIONS_PER_HOUR);
    });

    /** Клиент задаёт вопрос по «К оплате»: номер вопроса (строка просьбы) и сообщения сотруднику. */
    const askQuestion = async (question: string) => {
      await sent(owner, cpA);
      await press(askData, CLIENT_1, tg.messageIds[0]!);
      await toBot(question, CLIENT_1, 'client_one', lastMessageId(CLIENT_1));
      const row = (await messages(cpA)).find((m) => m.kind === 'ask' && m.answeredAt !== null);
      expect(row).toBeTruthy();
      return { id: row!.id, staffMessage: lastMessageId(CHAT_ACC) };
    };
    /** Записи истории «Ответ контрагенту в Telegram» с пометкой «через Telegram». */
    const answers = async () =>
      f.t.admin.db
        .select({
          userId: schema.auditLog.actorUserId,
          via: schema.auditLog.via,
          changes: schema.auditLog.changes,
        })
        .from(schema.auditLog)
        .where(
          and(eq(schema.auditLog.contractorId, cpA), eq(schema.auditLog.action, 'page_tg_answer')),
        )
        .orderBy(asc(schema.auditLog.at), asc(schema.auditLog.id));
    /** Сообщение сотруднику с просьбой ответить на вопрос — как его отправил бы бот. */
    const giveAsk = async (login: string, chatId: number, questionId: string) => {
      const message: BotMessage = {
        heading: ASK_HEADING,
        text: 'Вопрос',
        ask: { action: CP_TG_ANSWER_ACTION, arg: questionId, kind: 'text' },
      };
      const person = f.people[login]!;
      expect(
        await sendBotMessage(
          f.deps,
          { userId: person.userId, chatId },
          message,
          'cp_tg_request',
          't',
        ),
      ).toBe(true);
      return lastMessageId(chatId);
    };

    it('«Ответить»: ответ сотрудника на вопрос уходит в чат клиента и в историю от его имени; один ответ на вопрос', async () => {
      const q = await askQuestion('Можно оплатить частями?');
      expect(sentTo(CHAT_ACC).map((m) => m.text)).toEqual([
        `${ASK_HEADING}\n${text('tgCpAskStaff', {
          контрагент: 'ОсОО «Ала-Тоо Трейд»',
          телеграм: '@client_one',
          вопрос: 'Можно оплатить частями?',
        })}`,
      ]);
      expect(sentTo(CLIENT_1).at(-1)!.text).toBe(text('tgCpAskSent'));
      const before = sentTo(CLIENT_1).length;
      // Просьба открыта, но текст прислан в чат не ответом на сообщение — клиенту он не уходит.
      await toBot('Ответ без ответа', CHAT_ACC, 'acc_a');
      expect(sentTo(CLIENT_1)).toHaveLength(before);
      expect(await answers()).toEqual([]);

      await toBot('Да,  можно\nдвумя частями', CHAT_ACC, 'acc_a', q.staffMessage);
      expect(
        sentTo(CLIENT_1)
          .slice(before)
          .map((m) => m.text),
      ).toEqual([
        `${ANSWER_HEADING}\n${text('tgCpAnswer', { бухгалтер: 'acc-a', ответ: 'Да, можно двумя частями' })}`,
      ]);
      // Ответ — только в чат, откуда пришёл вопрос.
      expect(sentTo(CLIENT_2)).toHaveLength(1);
      expect(sentTo(CHAT_ACC).at(-1)!.text).toBe('Ответ отправлен клиенту в Telegram.');
      expect(await answers()).toEqual([
        {
          userId: f.people['acc-a']!.userId,
          via: 'telegram',
          changes: [
            { field: 'tgAnswer', to: { name: '@client_one', text: 'Да, можно двумя частями' } },
          ],
        },
      ]);

      // Одна просьба — один ответ: второй ответ на то же сообщение клиенту не уходит.
      await toBot('И ещё', CHAT_ACC, 'acc_a', q.staffMessage);
      expect(sentTo(CLIENT_1)).toHaveLength(before + 1);
      expect(await answers()).toHaveLength(1);
    });

    it('«Ответить»: чужая организация, область «Свои» и право проверяются; подключение должно действовать', async () => {
      const q = await askQuestion('Когда платить патент?');
      const before = sentTo(CLIENT_1).length;
      const hr = await signIn(f.app, 'hr-a', TEST_PASSWORD);
      await linkTelegram(f.app, hr, CHAT_HR, 'hr_a');
      await linkTelegram(f.app, senior, CHAT_SENIOR, 'senior_a');

      // Чужая организация: номер вопроса из просьбы ничего не открывает — вопроса для неё нет.
      const alien = await giveAsk('acc-b', CHAT_ACC_B, q.id);
      await toBot('Ответ из Б', CHAT_ACC_B, 'acc_b', alien);
      expect(sentTo(CHAT_ACC_B).at(-1)!.text).toBe(text('tgActStale'));
      // Область «Свои»: контрагент закреплён за другим сотрудником — «Нет права».
      const own = await giveAsk('hr-a', CHAT_HR, q.id);
      await toBot('Ответ кадров', CHAT_HR, 'hr_a', own);
      expect(sentTo(CHAT_HR).at(-1)!.text).toBe(text('tgActNoRight'));
      // Без права «Просматривать контрагентов» — «Нет права» (область «Все» не помогает).
      const right = and(
        eq(schema.rolePermissions.roleId, f.roleIds.senior),
        eq(schema.rolePermissions.permissionId, 'cpView'),
      );
      await f.t.admin.db.delete(schema.rolePermissions).where(right);
      try {
        const m = await giveAsk('senior-a', CHAT_SENIOR, q.id);
        await toBot('Ответ старшего', CHAT_SENIOR, 'senior_a', m);
        expect(sentTo(CHAT_SENIOR).at(-1)!.text).toBe(text('tgActNoRight'));
      } finally {
        await f.t.admin.db
          .insert(schema.rolePermissions)
          .values({ orgId: f.a.orgId, roleId: f.roleIds.senior, permissionId: 'cpView' });
      }
      expect(sentTo(CLIENT_1)).toHaveLength(before);
      expect(await answers()).toEqual([]);

      // Раздел «Telegram» страницы скрыт — клиенту писать нельзя, просьба закрывается.
      const hide = (hiddenSections: 'tg'[]) =>
        f.t.admin.db
          .update(schema.contractorPages)
          .set({ hiddenSections })
          .where(eq(schema.contractorPages.contractorId, cpA));
      await hide(['tg']);
      try {
        await toBot('Ответ при скрытом разделе', CHAT_ACC, 'acc_a', q.staffMessage);
        expect(sentTo(CHAT_ACC).at(-1)!.text).toBe(
          'Ответ не отправлен: этот Telegram больше не подключён к контрагенту.',
        );
      } finally {
        await hide([]);
      }
      // Функция «Страница контрагента по ссылке» выключена — тоже «не подключён».
      await features(f.a.orgId, { telegram: true, taxpay: true, fee: true });
      try {
        const off = await giveAsk('acc-a', CHAT_ACC, q.id);
        await toBot('Ответ без страницы', CHAT_ACC, 'acc_a', off);
        expect(sentTo(CHAT_ACC).at(-1)!.text).toBe(
          'Ответ не отправлен: этот Telegram больше не подключён к контрагенту.',
        );
      } finally {
        await features(f.a.orgId, ALL_ON);
      }
      expect(sentTo(CLIENT_1)).toHaveLength(before);
      expect(await answers()).toEqual([]);

      // С правом и областью «Все» — ответ уходит от имени отвечающего.
      const m = await giveAsk('senior-a', CHAT_SENIOR, q.id);
      await toBot('Ответ старшего', CHAT_SENIOR, 'senior_a', m);
      expect(sentTo(CLIENT_1).at(-1)!.text).toBe(
        `${ANSWER_HEADING}\n${text('tgCpAnswer', { бухгалтер: 'senior-a', ответ: 'Ответ старшего' })}`,
      );
      expect((await answers()).map((a) => a.userId)).toEqual([f.people['senior-a']!.userId]);
    });

    it('«Ответить»: Telegram не принял ответ — истории нет, просьба ждёт; повторный ответ уходит', async () => {
      const q = await askQuestion('Сколько платить?');
      const before = sentTo(CLIENT_1).length;
      tg.failNext({
        ok: false as const,
        errorCode: 403,
        description: 'bot was blocked',
        permanent: true,
      });
      await toBot('Сумма в сообщении', CHAT_ACC, 'acc_a', q.staffMessage);
      expect(sentTo(CHAT_ACC).at(-1)!.text).toBe(
        'Ответ не отправлен: Telegram не принял сообщение. Попробуйте ответить ещё раз позже.',
      );
      expect(await answers()).toEqual([]);
      // Повтор — длинным ответом: клиенту — до 500 знаков с «…», в историю — первые 200.
      const long = `Сумма в сообщении. ${'Подробности. '.repeat(60)}`;
      await toBot(long, CHAT_ACC, 'acc_a', q.staffMessage);
      const shown = `${[...long.trim()].slice(0, 499).join('')}…`;
      expect([...shown]).toHaveLength(500);
      expect(
        sentTo(CLIENT_1)
          .slice(before)
          .map((m) => m.text),
      ).toEqual([`${ANSWER_HEADING}\n${text('tgCpAnswer', { бухгалтер: 'acc-a', ответ: shown })}`]);
      expect(await answers()).toEqual([
        expect.objectContaining({
          changes: [
            {
              field: 'tgAnswer',
              to: { name: '@client_one', text: [...shown].slice(0, 200).join('') },
            },
          ],
        }),
      ]);
    });

    it('само «К оплате» в отмеченный день до срока: только при включённой настройке, одно на месяц, чат и день', async () => {
      // Настройка выключена — ничего не уходит.
      await runJob();
      expect(tg.sent).toEqual([]);

      await autoPay(f.a.orgId, true);
      try {
        // Есть отчёт без суммы — сообщение ждёт, пока суммы месяца не указаны.
        await report('utli', f.a.orgId, {
          contractorId: cpA,
          responsibleEmployeeId: employee('acc-a'),
          period: 'M',
          periodStart: '2026-09-01',
          reportTypeCode: 'utli',
          act: 'both',
          dueBase: '2026-10-20',
          dueDate: '2026-10-20',
          payDue: '2026-10-20',
        });
        await runJob();
        expect(tg.sent).toEqual([]);
        await f.t.admin.db.delete(schema.reports).where(eq(schema.reports.id, ids.utli!));

        // Первому клиенту Telegram сообщение не принял — уйдёт со следующим запуском.
        tg.failNext({
          ok: false,
          errorCode: 500,
          description: 'Internal Server Error',
          permanent: false,
        });
        await runJob();
        expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_2]);
        expect(tg.sent[0]!.text).toContain('Налоги к оплате до 20.10.2026');
        expect(tg.sent[0]!.text).toContain(som(TOTAL));
        expect(tg.sent[0]!.options?.keyboard?.[0]).toEqual([COPY_PHONE]);
        expect(tg.sent[0]!.text).toContain(REQUISITE_BLOCK);
        // До повтора сумма патента выросла: не ушедшее сообщение собирается заново — клиент получает
        // сегодняшнюю сумму, а не вчерашнюю.
        await f.t.admin.db
          .update(schema.reports)
          .set({ amount: 87_050 + MORE })
          .where(eq(schema.reports.id, ids.pat!));
        await runJob();
        expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_2, CLIENT_1]);
        expect(tg.sent[1]!.text).toContain(som(TOTAL + MORE));
        expect(tg.sent[1]!.text).not.toContain(som(TOTAL));
        // Повтор и догоняющий запуск ничего не добавляют.
        await runJob();
        await runJob();
        expect(tg.sent).toHaveLength(2);
        expect(
          (await messages(cpA)).map((r) => [r.chatId, r.auto, r.month, r.attempts, r.sentBy]),
        ).toEqual([
          [CLIENT_1, true, SEP, 2, null],
          [CLIENT_2, true, SEP, 1, null],
        ]);
        expect((await messages(cpA)).map((r) => r.total)).toEqual([TOTAL + MORE, TOTAL]);
        // История — от имени системы, с пометкой «само».
        expect(await history(cpA)).toEqual([
          {
            action: 'page_tg_pay',
            userId: null,
            changes: [
              { field: 'tgPay', to: { month: SEP, total: TOTAL, recipients: 1, auto: true } },
            ],
          },
          {
            action: 'page_tg_pay',
            userId: null,
            changes: [
              {
                field: 'tgPay',
                to: { month: SEP, total: TOTAL + MORE, recipients: 1, auto: true },
              },
            ],
          },
        ]);
        // Организации Б (настройка выключена) ничего не ушло.
        expect(await messages(cpB)).toEqual([]);
        // Кнопки самого сообщения работают так же.
        expect(await press(paidData, CLIENT_1, tg.messageIds[1]!)).toMatchObject({
          text: text('tgCpPaidOk'),
        });
        // Ручная отправка от самого сообщения не зависит.
        expect(await sent(owner, cpA)).toEqual({ recipients: 2, delivered: 2 });
      } finally {
        await autoPay(f.a.orgId, false);
        await f.t.admin.db
          .update(schema.reports)
          .set({ amount: 87_050 })
          .where(eq(schema.reports.id, ids.pat!));
      }
    });

    it('само «К оплате» без реквизитов не уходит: ответственному — «не отправлено» с подсказкой, один раз на месяц', async () => {
      const notice = (hint: string) =>
        `${UI_TEXTS['cppage.tg.staff.noreq_heading'].ru}\n${text('tgCpNoReq', { контрагент: CP_A })} ${hint}`;
      await autoPay(f.a.orgId, true);
      try {
        // «Как оплатить» скрыт.
        await hidePage(cpA, ['pay']);
        await runJob();
        await runJob();
        expect(tg.sent.map((m) => [m.chatId, m.text])).toEqual([
          [CHAT_ACC, notice(UI_TEXTS['cppage.tg.rq.hidden_staff'].ru)],
        ]);
        await hidePage(cpA, []);
        await wipe();
        // Деньги на налоги переводят организации, счёта для налогов нет.
        await setContractor(cpA, { paysTo: 'org' });
        await runJob();
        await runJob();
        expect(tg.sent.map((m) => [m.chatId, m.text])).toEqual([
          [CHAT_ACC, notice(UI_TEXTS['cppage.tg.rq.org_hint'].ru)],
        ]);
        await setContractor(cpA, { paysTo: 'emp' });
        await wipe();
        // Реквизитов нет у ответственного; ответственный без Telegram — сообщение владельцу.
        await setContractor(cpA, { responsibleEmployeeId: employee('chief-a') });
        await runJob();
        expect(tg.sent.map((m) => [m.chatId, m.text])).toEqual([
          [
            CHAT_OWNER,
            notice(formatText(UI_TEXTS['cppage.tg.rq.emp_hint'].ru, { employee: 'chief-a' })),
          ],
        ]);
        await setContractor(cpA, { responsibleEmployeeId: employee('acc-a') });
        // Клиентам ничего не ушло и не записано; реквизиты появились — «К оплате» уходит.
        expect(await messages(cpA)).toEqual([]);
        await runJob();
        expect(sentTo(CLIENT_1)).toHaveLength(1);
        expect(sentTo(CLIENT_1)[0]!.text).toContain(REQUISITE_BLOCK);
      } finally {
        await autoPay(f.a.orgId, false);
        await hidePage(cpA, []);
        await setContractor(cpA, { paysTo: 'emp', responsibleEmployeeId: employee('acc-a') });
      }
    });

    it('задача «К оплате» идёт каждые 5 минут; организация — в запуск своего времени отправки', async () => {
      // Расписания задач читаются по времени Бишкека (UTC+6).
      const schedule = parseCron(contractorPayJob.cron);
      expect(schedule.matches(new Date('2026-10-18T03:00:00Z'))).toBe(true);
      expect(schedule.matches(new Date('2026-10-18T03:05:00Z'))).toBe(true);
      expect(schedule.matches(new Date('2026-10-18T03:07:00Z'))).toBe(false);
      await autoPay(f.b.orgId, true);
      try {
        // 08:55 и 09:05 — не время организации Б (09:00): ничего не уходит.
        for (const slot of ['2026-10-18T02:55:00Z', '2026-10-18T03:05:00Z']) {
          await contractorPayJob.run(f.deps, new Date(slot));
        }
        expect(tg.sent).toEqual([]);
        // Время отправки — 08:57: уходит в запуск 09:00 (минуты 08:56–09:00 — его).
        await f.t.admin.db
          .update(schema.orgTelegramNotices)
          .set({ atTime: '08:57' })
          .where(eq(schema.orgTelegramNotices.orgId, f.b.orgId));
        await contractorPayJob.run(f.deps, new Date('2026-10-18T03:00:00Z'));
        expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_B]);
        expect((await messages(cpB)).map((r) => r.day)).toEqual(['2026-10-18']);
      } finally {
        await f.t.admin.db
          .update(schema.orgTelegramNotices)
          .set({ atTime: '09:00' })
          .where(eq(schema.orgTelegramNotices.orgId, f.b.orgId));
        await autoPay(f.b.orgId, false);
      }
    });

    it('само «К оплате» — в каждый отмеченный день «за N» до срока; после «Оплатил» за месяц больше не уходит', async () => {
      await autoPay(f.b.orgId, true);
      const days = (value: number[]) =>
        f.t.admin.db
          .update(schema.orgTelegramNotices)
          .set({ days: value })
          .where(eq(schema.orgTelegramNotices.orgId, f.b.orgId));
      // Запуск 09:00 по Бишкеку в день `day` (срок оплаты — 20.10).
      const runOn = (day: string) => contractorPayJob.run(f.deps, new Date(`${day}T03:00:00Z`));
      try {
        // Отмечены «за 3» и «за 1»: 18.10 — «за 2», не уходит; 17.10 — «за 3» и 19.10 — «за 1».
        await days([3, 1]);
        await runOn('2026-10-18');
        expect(tg.sent).toEqual([]);
        await runOn('2026-10-17');
        await runOn('2026-10-19');
        // Повтор запуска в тот же день второго не отправляет.
        await runOn('2026-10-19');
        expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_B, CLIENT_B]);
        expect((await messages(cpB)).map((r) => [r.month, r.day, r.auto])).toEqual([
          [SEP, '2026-10-17', true],
          [SEP, '2026-10-19', true],
        ]);
        // «Оплатил» под сообщением: клиент сообщил об оплате — сообщение «ждёт подтверждения».
        expect(await press(paidData, CLIENT_B, lastMessageId(CLIENT_B))).toMatchObject({
          text: text('tgCpPaidOk'),
        });
        const [claim] = await f.t.admin.db.select().from(schema.contractorPayClaims);
        expect(claim).toMatchObject({
          orgId: f.b.orgId,
          contractorId: cpB,
          source: 'telegram',
          purpose: 'tax',
          month: SEP,
          status: 'wait',
          sentFileId: null,
        });
        expect(claim!.amount).toBeGreaterThan(0);
        // Отмечены все дни: за сентябрь сообщение больше не уходит, пока «Оплатил» не отклонили.
        await days([5, 4, 3, 2, 1]);
        tg.sent.length = 0;
        await runOn('2026-10-18');
        expect(tg.sent).toEqual([]);
        await f.t.admin.db
          .update(schema.contractorPayClaims)
          .set({ status: 'rejected', decidedAt: new Date() });
        await runOn('2026-10-18');
        expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_B]);
      } finally {
        await days([5, 4, 3, 2, 1]);
        await autoPay(f.b.orgId, false);
      }
    });

    it('само «К оплате» по годовому отчёту: месяц отчёта — декабрь, а срок оплаты — через несколько дней', async () => {
      await autoPay(f.b.orgId, true);
      // Годовой отчёт за 2026 год: его месяц — декабрь 2026, а срок оплаты — 21.10.2026.
      await report('yearB', f.b.orgId, {
        contractorId: cpB,
        responsibleEmployeeId: employee('acc-b'),
        period: 'Y',
        periodStart: '2026-01-01',
        reportTypeCode: 'pat',
        act: 'pay',
        dueBase: '2026-10-21',
        dueDate: '2026-10-21',
        payDue: '2026-10-21',
        amount: 300_000,
      });
      const other = {
        contractorId: cpB,
        responsibleEmployeeId: employee('acc-b'),
        period: 'M' as const,
        reportTypeCode: 'pat',
        act: 'pay' as const,
        dueBase: '2026-10-22',
        dueDate: '2026-10-22',
        amount: 100_000,
      };
      // Срока оплаты нет — берётся срок сдачи.
      await report('juneB', f.b.orgId, { ...other, periodStart: '2026-06-01' });
      // Прежняя версия уточнённого отчёта и «Не требуется» месяц в отправку не приводят.
      await report('mayB', f.b.orgId, {
        ...other,
        periodStart: '2026-05-01',
        payDue: '2026-10-21',
        superseded: true,
      });
      await report('aprB', f.b.orgId, {
        ...other,
        periodStart: '2026-04-01',
        payDue: '2026-10-21',
        status: 'not_required',
      });
      try {
        await runJob();
        expect((await messages(cpB)).map((r) => [r.month, r.total]).sort()).toEqual([
          ['2026-06', 100_000],
          ['2026-09', 250_000],
          ['2026-12', 300_000],
        ]);
        expect(
          sentTo(CLIENT_B)
            .map((m) => m.text.split('\n')[0])
            .sort(),
        ).toEqual([
          'Налоги к оплате до 20.10.2026',
          'Налоги к оплате до 21.10.2026',
          'Налоги к оплате до 22.10.2026',
        ]);
      } finally {
        await f.t.admin.db.delete(schema.contractorPayClaims);
        await f.t.admin.db.delete(schema.contractorTelegramMessages);
        for (const key of ['yearB', 'juneB', 'mayB', 'aprB']) {
          await f.t.admin.db.delete(schema.reports).where(eq(schema.reports.id, ids[key]!));
        }
        await autoPay(f.b.orgId, false);
      }
    });

    it('заблокированной организации само «К оплате» не уходит', async () => {
      await autoPay(f.b.orgId, true);
      const status = (value: 'active' | 'blocked') =>
        f.t.admin.db
          .update(schema.organizations)
          .set({ status: value })
          .where(eq(schema.organizations.id, f.b.orgId));
      try {
        await status('blocked');
        await runJob();
        expect(tg.sent).toEqual([]);
        expect(await messages(cpB)).toEqual([]);
        await status('active');
        await runJob();
        expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_B]);
      } finally {
        await status('active');
        await autoPay(f.b.orgId, false);
      }
    });

    it('само «К оплате» не уходит без функций организации и когда срок далеко или прошёл', async () => {
      await autoPay(f.a.orgId, true);
      await autoPay(f.b.orgId, true);
      try {
        await features(f.a.orgId, { cppage: true, taxpay: true });
        // У организации Б срок оплаты 20.10 сдвинут: больше 5 дней и уже прошёл.
        for (const payDue of ['2026-10-24', '2026-10-17']) {
          await f.t.admin.db
            .update(schema.reports)
            .set({ payDue })
            .where(eq(schema.reports.id, ids.ndsB!));
          await runJob();
          expect(tg.sent).toEqual([]);
        }
        // За 5 дней — уходит.
        await f.t.admin.db
          .update(schema.reports)
          .set({ payDue: '2026-10-23' })
          .where(eq(schema.reports.id, ids.ndsB!));
        await runJob();
        expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_B]);
        expect(tg.sent[0]!.text).toContain('Налоги к оплате до 23.10.2026');
        expect(tg.sent[0]!.text).not.toContain('Ала-Тоо');
      } finally {
        await f.t.admin.db
          .update(schema.reports)
          .set({ payDue: '2026-10-20' })
          .where(eq(schema.reports.id, ids.ndsB!));
        await features(f.a.orgId, ALL_ON);
        await autoPay(f.a.orgId, false);
        await autoPay(f.b.orgId, false);
      }
    });

    /*
     * Напоминание клиенту о долге (доработки 13.11.2026, задача К5; прототип v94 cp-telegram.js:
     * pgDebt, pgDebtTo, pgDebtMsg, tgAct('cp-nodebt')). Сегодня в тестах — воскресенье 18.10.2026;
     * задача напоминаний запускается с часами понедельника 19.10 и вторника 20.10.
     */
    describe('напоминание о долге (К5)', () => {
      const MONDAY = '2026-10-19T04:00:00Z';
      const TUESDAY = '2026-10-20T04:00:00Z';
      const WEEK = '2026-10-19';
      /** Недостача на налоги октября: остаток НДС и патент — денег от контрагента нет. */
      const SHORT = TOTAL;
      /** Долг за обслуживание: 3 000 сом в месяц с июля, срок оплаты октября (10-е) прошёл. */
      const FEE = 4 * 300_000;
      const FEE_REQUISITE_PART = '0555 987 654';
      const noDebtData = botPressData('cpNoDebt');
      const reqData = (arg: string) => botPressData('cpReq', arg);

      const runDebt = (now = MONDAY) =>
        contractorDebtJob.run({ ...f.deps, clock: fixedClock(now) }, new Date(now));
      const orgDebt = (orgId: string, on: boolean) =>
        f.t.admin.db
          .update(schema.orgSettings)
          .set({ cpTgDebt: on })
          .where(eq(schema.orgSettings.orgId, orgId));
      const hide = (cp: string, sections: string[]) =>
        f.t.admin.db
          .update(schema.contractorPages)
          .set({ hiddenSections: sections })
          .where(eq(schema.contractorPages.contractorId, cp));
      const debtHistory = async (contractorId: string) =>
        (
          await f.t.admin.db
            .select({
              action: schema.auditLog.action,
              userId: schema.auditLog.actorUserId,
              changes: schema.auditLog.changes,
            })
            .from(schema.auditLog)
            .where(
              and(
                eq(schema.auditLog.contractorId, contractorId),
                eq(schema.auditLog.entity, 'contractor_page'),
              ),
            )
            .orderBy(asc(schema.auditLog.at), asc(schema.auditLog.id))
        ).filter((h) => ['page_tg_nodebt', 'page_tg_debt_on'].includes(h.action));
      const card = async (cookie: string, cp: string) => {
        const res = await call(cookie, 'GET', `/api/contractors/${cp}/page/telegram`);
        expect(res.status, await res.clone().text()).toBe(200);
        return ContractorTelegram.parse(await res.json());
      };
      const toggle = (cookie: string | undefined, cp: string, on: unknown, version: unknown) =>
        call(cookie, 'POST', `/api/contractors/${cp}/page/telegram/debt`, { on, version });

      beforeAll(async () => {
        // Начисления идут с месяца создания контрагента: в тестах часы стоят на октябре 2026,
        // поэтому контрагент «создан» в июне — иначе долга за обслуживание нет.
        await f.t.admin.db
          .update(schema.contractors)
          .set({ createdAt: new Date('2026-06-20T10:00:00+06:00') })
          .where(eq(schema.contractors.id, cpA));
        await f.t.admin.db.insert(schema.contractorTariffs).values({
          orgId: f.a.orgId,
          contractorId: cpA,
          amount: 300_000,
          period: 'M',
          validFrom: '2026-07-01',
        });
        // Основной счёт организации для платы за обслуживание.
        const account = await call(owner, 'POST', '/api/org/accounts', {
          kind: 'phone',
          bankCode: null,
          accountNo: null,
          bik: null,
          phone: '+996555987654',
          phoneBanks: [MBANK],
          holderName: 'Организация А',
          purpose: 'fee',
          mainTax: false,
          mainFee: true,
        });
        expect(account.status, await account.clone().text()).toBe(200);
      });

      beforeEach(async () => {
        await f.t.admin.db.execute(
          sql`delete from audit_log where action in ('page_tg_nodebt', 'page_tg_debt_on')`,
        );
        await f.t.admin.db.update(schema.contractorTelegramLinks).set({ noDebt: false });
        await f.t.admin.db
          .update(schema.contractorPages)
          .set({ tgDebtOff: false, hiddenSections: [] });
        await orgDebt(f.a.orgId, true);
        await orgDebt(f.b.orgId, false);
      });

      afterAll(async () => {
        await orgDebt(f.a.orgId, false);
        await f.t.admin.db
          .delete(schema.contractorTariffs)
          .where(eq(schema.contractorTariffs.contractorId, cpA));
      });

      it('в понедельник в 10:00 — каждому подключённому: недостача на налоги и долг за обслуживание, реквизиты, «Не напоминать»', async () => {
        await runDebt();
        expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_1, CLIENT_2]);
        const message = tg.sent[0]!;
        expect(message.text.split('\n').slice(0, 3)).toEqual([
          'Напоминание об оплате',
          'ОсОО «Ала-Тоо Трейд»',
          text('tgCpDebt', { сумма: som(SHORT + FEE) }),
        ]);
        expect(message.text).toContain('Не хватает на налоги этого месяца');
        expect(message.text).toContain('Долг за обслуживание');
        const keyboard = message.options?.keyboard ?? [];
        // Одна кнопка «Показать реквизиты для перевода» на обе части долга (прототип v110):
        // реквизиты в самом напоминании не приходят.
        expect(keyboard).toEqual([
          [{ text: text('tgBtnCpShowReq'), data: reqData('tax-fee') }],
          [{ text: text('tgBtnCpNoDebt'), data: noDebtData }],
        ]);
        expect(message.text).not.toContain('0555');
        // Повтор и догоняющий запуск второго напоминания за неделю не создают.
        await runDebt();
        await runDebt(TUESDAY);
        expect(tg.sent).toHaveLength(2);
        expect(
          (await messages(cpA)).map((r) => [
            r.chatId,
            r.kind,
            r.week,
            r.total,
            r.attempts,
            r.sentBy,
          ]),
        ).toEqual([
          [CLIENT_1, 'debt', WEEK, SHORT + FEE, 1, null],
          [CLIENT_2, 'debt', WEEK, SHORT + FEE, 1, null],
        ]);
        // Сотрудникам и организации Б (у неё напоминания выключены) ничего не ушло.
        expect(await messages(cpB)).toEqual([]);
        // Следующий понедельник — новое напоминание.
        await runDebt('2026-10-26T04:00:00Z');
        expect(tg.sent).toHaveLength(4);
      });

      it('«Показать реквизиты для перевода»: реквизиты на момент нажатия по каждой части долга с кнопкой копирования; кнопка не гаснет', async () => {
        await runDebt();
        const messageId = tg.messageIds[0]!;
        tg.sent.length = 0;
        tg.messageIds.length = 0;
        expect(await press(reqData('tax-fee'), CLIENT_1, messageId)).toEqual({
          callbackId: expect.any(String),
          text: undefined,
          alert: false,
        });
        // Два сообщения: «Для налогов» — реквизит ответственного, «Для обслуживания» — основной счёт
        // организации для обслуживания; у каждого — своя кнопка копирования.
        expect(tg.sent.map((m) => [m.chatId, m.text, m.options?.keyboard])).toEqual([
          [CLIENT_1, ['Для налогов', CP_A, REQUISITE_BLOCK].join('\n'), [[COPY_PHONE]]],
          [
            CLIENT_1,
            [
              'Для обслуживания',
              CP_A,
              'Реквизиты для перевода — организации Организация А',
              `Перевод по номеру телефона: ${FEE_REQUISITE_PART}`,
              'Банки и кошельки: M-Bank',
              'Получатель: Организация А',
            ].join('\n'),
            [[{ text: text('tgBtnCpCopyPhone'), copy: '0555987654' }]],
          ],
        ]);
        // Кнопка не гаснет, сообщения с реквизитами не записываются (нажимать на них нечего), истории нет.
        expect(tg.edits).toEqual([]);
        expect((await messages(cpA)).map((r) => [r.chatId, r.kind])).toEqual([
          [CLIENT_1, 'debt'],
          [CLIENT_2, 'debt'],
        ]);
        expect(await history(cpA)).toEqual([]);

        // Без «Платы за обслуживание» — только реквизиты для налогов.
        tg.sent.length = 0;
        await features(f.a.orgId, { cppage: true, telegram: true, taxpay: true });
        await press(reqData('tax-fee'), CLIENT_1, messageId);
        await features(f.a.orgId, ALL_ON);
        expect(tg.sent.map((m) => m.text.split('\n')[0])).toEqual(['Для налогов']);
        // «Как оплатить» скрыли после напоминания — реквизитов клиент не получает.
        tg.sent.length = 0;
        await hide(cpA, ['pay']);
        expect(await press(reqData('tax-fee'), CLIENT_1, messageId)).toMatchObject({
          text: text('tgCpNoReq', { контрагент: CP_A }),
          alert: true,
        });
        await hide(cpA, []);
        // Данные кнопки подделаны (такой кнопки в напоминании нет) и чужой чат — ничего.
        expect(await press(reqData('fee'), CLIENT_1, messageId)).toMatchObject({
          text: text('tgActStale'),
          alert: true,
        });
        await press(reqData('tax-fee'), CLIENT_1, messageId, STRANGER);
        expect(tg.sent.filter((m) => m.chatId === CLIENT_1)).toEqual([]);
        // То же нажатие из другого чата этого контрагента и из чата организации Б: сообщение ищется
        // только в чате нажатия — чужое напоминание не найдено, реквизитов организации А нет.
        for (const chat of [CLIENT_2, CLIENT_B]) {
          expect(await press(reqData('tax-fee'), chat, messageId)).toMatchObject({
            text: text('tgActStale'),
            alert: true,
          });
        }
        expect(tg.sent).toEqual([]);

        // Реквизита для налогов нет (у контрагента нет ответственного) — только «Для обслуживания»;
        // раздел «Оплата за обслуживание» скрыт — только «Для налогов», как на странице.
        const [was] = await f.t.admin.db
          .select({ resp: schema.contractors.responsibleEmployeeId })
          .from(schema.contractors)
          .where(eq(schema.contractors.id, cpA));
        await f.t.admin.db
          .update(schema.contractors)
          .set({ responsibleEmployeeId: null })
          .where(eq(schema.contractors.id, cpA));
        await press(reqData('tax-fee'), CLIENT_1, messageId);
        await f.t.admin.db
          .update(schema.contractors)
          .set({ responsibleEmployeeId: was!.resp })
          .where(eq(schema.contractors.id, cpA));
        expect(tg.sent.map((m) => m.text.split('\n')[0])).toEqual(['Для обслуживания']);
        tg.sent.length = 0;
        await hide(cpA, ['fee']);
        await press(reqData('tax-fee'), CLIENT_1, messageId);
        await hide(cpA, []);
        expect(tg.sent.map((m) => m.text.split('\n')[0])).toEqual(['Для налогов']);
        tg.sent.length = 0;

        // Не больше 10 раз в час с одного подключения.
        await f.t.admin.db.execute(sql`delete from rate_limits where kind = 'cp_tg_req'`);
        for (let i = 0; i < CP_TG_REQ_PER_HOUR; i += 1) {
          await press(reqData('tax-fee'), CLIENT_1, messageId);
        }
        expect(tg.sent.filter((m) => m.chatId === CLIENT_1)).toHaveLength(2 * CP_TG_REQ_PER_HOUR);
        tg.sent.length = 0;
        expect(await press(reqData('tax-fee'), CLIENT_1, messageId)).toMatchObject({
          text: UI_TEXTS['cppage.tg.req_limit'].ru,
          alert: true,
        });
        expect(tg.sent).toEqual([]);
      });

      it('задача идёт каждые 5 минут; организация — в своё время (по умолчанию 10:00), новые — только в выбранный день недели', async () => {
        // Расписания задач читаются по времени Бишкека (UTC+6).
        const schedule = parseCron(contractorDebtJob.cron);
        expect(schedule.matches(new Date('2026-10-19T04:00:00Z'))).toBe(true);
        expect(schedule.matches(new Date('2026-10-19T04:05:00Z'))).toBe(true);
        expect(schedule.matches(new Date('2026-10-19T04:03:00Z'))).toBe(false);
        // Не понедельник — новых нет; понедельник не в 10:00 — тоже.
        for (const day of [
          '2026-10-18T04:00:00Z',
          TUESDAY,
          '2026-10-24T04:00:00Z',
          '2026-10-19T03:55:00Z',
          '2026-10-19T04:05:00Z',
        ]) {
          await runDebt(day);
        }
        expect(tg.sent).toEqual([]);
        expect(await messages(cpA)).toEqual([]);
        // Запуск понедельника 10:00 догоняется позже (исполнитель стоял): день — по времени запуска из
        // расписания, а не по часам — напоминания этой недели создаются.
        await contractorDebtJob.run(
          { ...f.deps, clock: fixedClock('2026-10-20T02:00:00Z') },
          new Date(MONDAY),
        );
        expect(tg.sent.map((m) => m.chatId).sort()).toEqual([CLIENT_1, CLIENT_2].sort());
        expect((await messages(cpA)).map((r) => r.week)).toEqual([WEEK, WEEK]);
      });

      it('день недели и время — из строки «Оплата за обслуживание»: пятница в 18:30', async () => {
        await f.t.admin.db.insert(schema.orgTelegramNotices).values({
          orgId: f.a.orgId,
          code: 'cp_fee',
          days: [5],
          atTime: '18:30',
          weekday: 5,
        });
        try {
          // Понедельник 10:00 и пятница 10:00 — не время организации.
          await runDebt(MONDAY);
          await runDebt('2026-10-23T04:00:00Z');
          expect(tg.sent).toEqual([]);
          // Пятница 18:30 по Бишкеку — 12:30 UTC.
          await runDebt('2026-10-23T12:30:00Z');
          expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_1, CLIENT_2]);
          expect((await messages(cpA)).map((r) => [r.kind, r.week])).toEqual([
            ['debt', WEEK],
            ['debt', WEEK],
          ]);
          // Суббота в то же время — только повтор не ушедших, новых нет.
          await runDebt('2026-10-24T12:30:00Z');
          expect(tg.sent).toHaveLength(2);
        } finally {
          await f.t.admin.db
            .delete(schema.orgTelegramNotices)
            .where(
              and(
                eq(schema.orgTelegramNotices.orgId, f.a.orgId),
                eq(schema.orgTelegramNotices.code, 'cp_fee'),
              ),
            );
        }
      });

      it('«Оплата за обслуживание до …» — в отмеченные дни до дня оплаты; после «Оплатил» за месяц не уходит', async () => {
        // Срок оплаты ноября — 01.11 (день оплаты контрагента — 1-е); отмечены «за 5» и «за 3».
        await f.t.admin.db.insert(schema.orgTelegramNotices).values({
          orgId: f.a.orgId,
          code: 'cp_fee',
          days: [5, 3],
          atTime: '10:00',
          weekday: 1,
        });
        const runOn = (day: string) => runDebt(`${day}T04:00:00Z`);
        const NOV = '2026-11';
        // «Прислать чек» — когда контрагент может отправлять файлы (функция «Файлы в карточках»).
        await features(f.a.orgId, { ...ALL_ON, files: true });
        // «До срока» — не напоминание о долге: выключатель сотрудника у контрагента его не останавливает
        // (прототип v115 pgFeeSoon → pgFeeTo).
        await f.t.admin.db
          .update(schema.contractorPages)
          .set({ tgDebtOff: true })
          .where(eq(schema.contractorPages.contractorId, cpA));
        try {
          // 28.10 — «за 4»: не уходит; 27.10 — «за 5».
          await runOn('2026-10-28');
          expect(tg.sent).toEqual([]);
          await runOn('2026-10-27');
          await runOn('2026-10-27');
          expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_1, CLIENT_2]);
          const message = tg.sent[0]!;
          expect(message.text.split('\n').slice(0, 3)).toEqual([
            text('tgCpFeeHead', { срок: '01.11.2026' }),
            CP_A,
            text('tgCpFeeSoon', { месяц: 'ноябрь 2026', сумма: som(300_000), срок: '01.11.2026' }),
          ]);
          expect(message.text).toContain(`Перевод по номеру телефона: ${FEE_REQUISITE_PART}`);
          expect(message.options?.keyboard).toEqual([
            [{ text: text('tgBtnCpCopyPhone'), copy: '0555987654' }],
            [
              { text: text('tgBtnCpPaid'), data: botPressData('cpPaid', 'fee') },
              { text: text('tgBtnCpReceipt'), data: botPressData('cpReceipt', 'fee') },
            ],
          ]);
          expect(
            (await messages(cpA)).map((r) => [r.chatId, r.kind, r.month, r.total, r.auto, r.day]),
          ).toEqual([
            [CLIENT_1, 'fee', NOV, 300_000, true, '2026-10-27'],
            [CLIENT_2, 'fee', NOV, 300_000, true, '2026-10-27'],
          ]);
          // Клиент выключил напоминания кнопкой «Не напоминать» — его чату не уходит.
          await f.t.admin.db
            .update(schema.contractorTelegramLinks)
            .set({ noDebt: true })
            .where(eq(schema.contractorTelegramLinks.chatId, CLIENT_2));
          // «Оплатил» под сообщением: за ноябрь «до срока» больше не уходит, пока его не отклонили.
          expect(
            await press(botPressData('cpPaid', 'fee'), CLIENT_1, tg.messageIds[0]!),
          ).toMatchObject({ text: text('tgCpPaidOk') });
          const [claim] = await f.t.admin.db.select().from(schema.contractorPayClaims);
          expect(claim).toMatchObject({
            contractorId: cpA,
            purpose: 'fee',
            month: NOV,
            amount: 300_000,
            status: 'wait',
          });
          tg.sent.length = 0;
          await runOn('2026-10-29');
          expect(tg.sent).toEqual([]);
          await f.t.admin.db
            .update(schema.contractorPayClaims)
            .set({ status: 'rejected', decidedAt: new Date() });
          await runOn('2026-10-29');
          expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_1]);
          // Раздел «Оплата за обслуживание» страницы скрыт — клиент не получает того, чего не видит.
          tg.sent.length = 0;
          await f.t.admin.db.delete(schema.contractorPayClaims);
          await f.t.admin.db.delete(schema.contractorTelegramMessages);
          await hide(cpA, ['fee']);
          await runOn('2026-10-29');
          expect(tg.sent).toEqual([]);
        } finally {
          await features(f.a.orgId, ALL_ON);
          await f.t.admin.db.update(schema.contractorPages).set({ tgDebtOff: false });
          await f.t.admin.db
            .delete(schema.orgTelegramNotices)
            .where(
              and(
                eq(schema.orgTelegramNotices.orgId, f.a.orgId),
                eq(schema.orgTelegramNotices.code, 'cp_fee'),
              ),
            );
        }
      });

      it('не ушедшее в понедельник повторяется в другие дни сегодняшним сообщением — до трёх попыток', async () => {
        tg.failNext({
          ok: false,
          errorCode: 500,
          description: 'Internal Server Error',
          permanent: false,
        });
        await runDebt();
        expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_2]);
        // За день патент оплатили: во вторник первому клиенту уходит уже меньший долг.
        await f.t.admin.db
          .update(schema.reports)
          .set({ paid: 87_050 })
          .where(eq(schema.reports.id, ids.pat!));
        try {
          await runDebt(TUESDAY);
          expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_2, CLIENT_1]);
          expect(tg.sent[1]!.text).toContain(
            text('tgCpDebt', { сумма: som(SHORT - 87_050 + FEE) }),
          );
          expect((await messages(cpA)).map((r) => [r.chatId, r.total, r.attempts])).toEqual([
            [CLIENT_1, SHORT - 87_050 + FEE, 2],
            [CLIENT_2, SHORT + FEE, 1],
          ]);
          await runDebt(TUESDAY);
          expect(tg.sent).toHaveLength(2);
        } finally {
          await f.t.admin.db
            .update(schema.reports)
            .set({ paid: 0 })
            .where(eq(schema.reports.id, ids.pat!));
        }
      });

      it('три выключателя: организация, сотрудник у контрагента, клиент у своего чата', async () => {
        // Организация выключила.
        await orgDebt(f.a.orgId, false);
        await runDebt();
        expect(tg.sent).toEqual([]);
        await orgDebt(f.a.orgId, true);
        // Сотрудник выключил у контрагента.
        await f.t.admin.db
          .update(schema.contractorPages)
          .set({ tgDebtOff: true })
          .where(eq(schema.contractorPages.contractorId, cpA));
        await runDebt();
        expect(tg.sent).toEqual([]);
        await f.t.admin.db.update(schema.contractorPages).set({ tgDebtOff: false });
        // Клиент нажал «Не напоминать» — второму чату напоминание идёт.
        await f.t.admin.db
          .update(schema.contractorTelegramLinks)
          .set({ noDebt: true })
          .where(eq(schema.contractorTelegramLinks.chatId, CLIENT_1));
        await runDebt();
        expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_2]);
      });

      it('клиент получает только то, что видит на своей странице; без долга, функций и у заблокированной организации напоминаний нет', async () => {
        const rows = () =>
          tg.sent.map((m) => [
            m.text.includes('Не хватает на налоги этого месяца'),
            m.text.includes('Долг за обслуживание'),
            (m.options?.keyboard ?? []).map((row) => row[0]!.text),
          ]);
        // Раздел «Оплата за обслуживание» скрыт — только недостача на налоги.
        await hide(cpA, ['fee']);
        await runDebt();
        expect(rows()[0]).toEqual([true, false, [text('tgBtnCpShowReq'), text('tgBtnCpNoDebt')]]);
        expect(tg.sent[0]!.options?.keyboard?.[0]?.[0]).toMatchObject({ data: reqData('tax') });
        expect(tg.sent[0]!.text).toContain(text('tgCpDebt', { сумма: som(SHORT) }));
        await wipe();
        // «Деньги на налоги» скрыты — только долг за обслуживание.
        await hide(cpA, ['money']);
        await runDebt();
        expect(rows()[0]).toEqual([false, true, [text('tgBtnCpShowReq'), text('tgBtnCpNoDebt')]]);
        expect(tg.sent[0]!.options?.keyboard?.[0]?.[0]).toMatchObject({ data: reqData('fee') });
        expect(tg.sent[0]!.text).toContain(text('tgCpDebt', { сумма: som(FEE) }));
        await wipe();
        // «Как оплатить» скрыт — реквизитов нет и в Telegram.
        await hide(cpA, ['pay']);
        await runDebt();
        expect(rows()[0]).toEqual([true, true, [text('tgBtnCpNoDebt')]]);
        expect(tg.sent[0]!.text).not.toContain('0555');
        await wipe();
        // Оба раздела скрыты, раздел «Telegram» скрыт — напоминаний нет.
        for (const sections of [['fee', 'money'], ['tg']]) {
          await hide(cpA, sections);
          await runDebt();
          expect(tg.sent).toEqual([]);
        }
        await hide(cpA, []);
        // Функции организации: без «Платы за обслуживание» — только налоги; без обеих — ничего.
        await features(f.a.orgId, { cppage: true, telegram: true, taxpay: true });
        await runDebt();
        expect(rows()[0]).toEqual([true, false, [text('tgBtnCpShowReq'), text('tgBtnCpNoDebt')]]);
        await wipe();
        const partly: Record<string, boolean>[] = [
          { cppage: true, telegram: true },
          { cppage: true, taxpay: true, fee: true },
          { telegram: true, taxpay: true, fee: true },
        ];
        for (const off of partly) {
          await features(f.a.orgId, off);
          await runDebt();
          expect(tg.sent).toEqual([]);
        }
        await features(f.a.orgId, ALL_ON);
        // Контрагент в архиве и заблокированная организация.
        await f.t.admin.db
          .update(schema.contractors)
          .set({ serviceStatus: 'archived' })
          .where(eq(schema.contractors.id, cpA));
        await runDebt();
        await f.t.admin.db
          .update(schema.contractors)
          .set({ serviceStatus: 'active' })
          .where(eq(schema.contractors.id, cpA));
        await f.t.admin.db
          .update(schema.organizations)
          .set({ status: 'blocked' })
          .where(eq(schema.organizations.id, f.a.orgId));
        await runDebt();
        await f.t.admin.db
          .update(schema.organizations)
          .set({ status: 'active' })
          .where(eq(schema.organizations.id, f.a.orgId));
        expect(tg.sent).toEqual([]);
        expect(await messages(cpA)).toEqual([]);
      });

      it('долга нет — напоминания нет; чужая организация получает только свой долг', async () => {
        await orgDebt(f.a.orgId, false);
        await orgDebt(f.b.orgId, true);
        await runDebt();
        // У контрагента организации Б — только недостача на его НДС.
        expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_B]);
        expect(tg.sent[0]!.text).toContain('ОсОО «Бишкек»');
        expect(tg.sent[0]!.text).toContain(text('tgCpDebt', { сумма: som(250_000) }));
        expect(tg.sent[0]!.text).not.toContain('Ала-Тоо');
        expect(await messages(cpA)).toEqual([]);
        await wipe();
        // НДС оплачен — долга нет.
        await f.t.admin.db
          .update(schema.reports)
          .set({ paid: 250_000 })
          .where(eq(schema.reports.id, ids.ndsB!));
        try {
          await runDebt();
          expect(tg.sent).toEqual([]);
          expect(await messages(cpB)).toEqual([]);
        } finally {
          await f.t.admin.db
            .update(schema.reports)
            .set({ paid: 0 })
            .where(eq(schema.reports.id, ids.ndsB!));
        }
      });

      it('«Не напоминать»: отметка у своего чата, история, кнопка гаснет; «Напоминать» включает снова', async () => {
        await runDebt();
        const [m1, m2] = tg.messageIds as [number, number];
        tg.sent.length = 0;
        // Чужой чат и подделанные данные кнопки напоминания не выключают.
        expect(await press(noDebtData, CLIENT_2, m1)).toMatchObject({ text: text('tgActStale') });
        expect(await press(noDebtData, CLIENT_B, m1)).toMatchObject({ text: text('tgActStale') });
        expect(await press(botPressData('cpNoDebt', cpB), CLIENT_1, m1)).toMatchObject({
          text: text('tgActStale'),
        });
        expect(await debtHistory(cpA)).toEqual([]);

        const answer = await press(noDebtData, CLIENT_1, m1);
        expect(answer).toMatchObject({ text: text('tgCpNoDebtOk'), alert: false });
        expect(tg.edits.at(-1)).toMatchObject({ chatId: CLIENT_1, messageId: m1 });
        expect(tg.edits.at(-1)!.keyboard.at(-1)).toEqual([
          { text: '✓ Напоминания выключены', data: 'off', disabled: true },
        ]);
        expect(await debtHistory(cpA)).toEqual([
          {
            action: 'page_tg_nodebt',
            userId: null,
            changes: [{ field: 'telegram', to: '@client_one' }],
          },
        ]);
        // Второе нажатие — «кнопка устарела», второй записи нет.
        expect(await press(noDebtData, CLIENT_1, m1)).toMatchObject({ text: text('tgActStale') });
        expect(await debtHistory(cpA)).toHaveLength(1);
        // В карточке у подключения — «напоминания о долге выключил клиент».
        expect((await card(owner, cpA)).items.map((i) => [i.name, i.noDebt]).sort()).toEqual([
          ['@client_one', true],
          ['@client_two', false],
        ]);
        // Сотрудникам ничего не уходит; на следующей неделе напоминание — только второму чату.
        expect(tg.sent).toEqual([]);
        await runDebt('2026-10-26T04:00:00Z');
        expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_2]);
        tg.sent.length = 0;

        // «Напоминать» из чата клиента включает напоминания снова.
        await toBot('Напоминать', CLIENT_1, 'client_one');
        expect(sentTo(CLIENT_1).map((m) => m.text)).toEqual([
          'Напоминания о долге снова включены: ОсОО «Ала-Тоо Трейд».',
        ]);
        expect((await debtHistory(cpA)).map((h) => h.action)).toEqual([
          'page_tg_nodebt',
          'page_tg_debt_on',
        ]);
        // Уже включены — бот так и отвечает, истории нет.
        await toBot('напоминать', CLIENT_2, 'client_two');
        expect(sentTo(CLIENT_2).at(-1)!.text).toBe('Напоминания о долге уже включены.');
        expect(await debtHistory(cpA)).toHaveLength(2);
        // Чат, не подключённый к контрагенту, и чат сотрудника — обычная подсказка бота (сотруднику —
        // подсказка меню команд, задача Т5).
        await toBot('Напоминать', STRANGER);
        expect(sentTo(STRANGER).at(-1)!.text).toBe(text('tgStart'));
        await toBot('Напоминать', CHAT_ACC, 'acc_a');
        expect(sentTo(CHAT_ACC).at(-1)!.text).toBe(UI_TEXTS['telegram.cmd.menu_hint'].ru);
        expect(await debtHistory(cpA)).toHaveLength(2);
        // Раздел «Telegram» страницы скрыт — подключение не действует: команда отметку клиента не
        // снимает («Не напоминать» в это время тоже не работает), бот отвечает обычной подсказкой.
        expect(await press(noDebtData, CLIENT_2, m2)).toMatchObject({ text: text('tgCpNoDebtOk') });
        await hide(cpA, ['tg']);
        try {
          await toBot('Напоминать', CLIENT_2, 'client_two');
          expect(sentTo(CLIENT_2).at(-1)!.text).not.toContain('Напоминания о долге');
          expect((await debtHistory(cpA)).map((h) => h.action)).toEqual([
            'page_tg_nodebt',
            'page_tg_debt_on',
            'page_tg_nodebt',
          ]);
        } finally {
          await hide(cpA, []);
        }
        // Функция «Страница контрагента по ссылке» выключена — то же самое.
        await features(f.a.orgId, { ...ALL_ON, cppage: false });
        try {
          await toBot('Напоминать', CLIENT_2, 'client_two');
          expect(sentTo(CLIENT_2).at(-1)!.text).not.toContain('Напоминания о долге');
          expect(await debtHistory(cpA)).toHaveLength(3);
        } finally {
          await features(f.a.orgId, ALL_ON);
        }
        // Второе напоминание недели первому чату не уходит — оно будет в следующий понедельник.
        expect(m2).toBeGreaterThan(m1);
      });

      it('«Не напоминать» не работает, когда раздел «Telegram» страницы скрыт', async () => {
        await runDebt();
        const [m1] = tg.messageIds as [number];
        await hide(cpA, ['tg']);
        expect(await press(noDebtData, CLIENT_1, m1)).toMatchObject({
          text: text('tgCpNotLinked'),
          alert: true,
        });
        expect(await debtHistory(cpA)).toEqual([]);
        await hide(cpA, []);
        expect(await press(noDebtData, CLIENT_1, m1)).toMatchObject({ text: text('tgCpNoDebtOk') });
      });

      it('карточка: «Напоминать о долге в Telegram» — состояние, сумма и что мешает', async () => {
        const debt = (await card(owner, cpA)).debt!;
        // Когда уходит — день недели и время строки «Оплата за обслуживание» (по умолчанию — понедельник, 10:00).
        expect(debt).toEqual({
          on: true,
          orgOn: true,
          refusal: null,
          sum: SHORT + FEE,
          weekDay: 1,
          at: '10:00',
          version: expect.any(Number),
        });
        await f.t.admin.db
          .insert(schema.orgTelegramNotices)
          .values({ orgId: f.a.orgId, code: 'cp_fee', days: [5], weekday: 4, atTime: '09:30' });
        try {
          expect((await card(owner, cpA)).debt).toMatchObject({ weekDay: 4, at: '09:30' });
        } finally {
          await f.t.admin.db
            .delete(schema.orgTelegramNotices)
            .where(eq(schema.orgTelegramNotices.orgId, f.a.orgId));
        }
        expect((await card(chief, cpA)).debt).toMatchObject({ refusal: null, sum: SHORT + FEE });
        // Бухгалтер: права «Управлять страницей контрагента» нет; плату за обслуживание он не видит —
        // суммы долга в ответе нет.
        expect((await card(acc, cpA)).debt).toMatchObject({
          on: true,
          refusal: 'page_debt_right',
          sum: null,
        });
        // «Старший»: контрагенты — все, права на плату и на финансовые операции есть, но финансы —
        // только своих контрагентов: суммы долга чужого контрагента нет (иначе из неё вычислялась бы
        // недостача на налоги, закрытая областью). Область «Все» — сумма видна.
        const finScope = (scope: 'own' | 'all') =>
          f.t.admin.db
            .update(schema.roleScopes)
            .set({ scope })
            .where(
              and(
                eq(schema.roleScopes.roleId, f.roleIds.senior),
                eq(schema.roleScopes.permGroup, 'fin'),
              ),
            );
        const grants = ['fee', 'finView'];
        await f.t.admin.db.insert(schema.rolePermissions).values(
          grants.map((permissionId) => ({
            orgId: f.a.orgId,
            roleId: f.roleIds.senior,
            permissionId,
          })),
        );
        try {
          await finScope('own');
          expect((await card(senior, cpA)).debt).toMatchObject({ on: true, sum: null });
          await finScope('all');
          expect((await card(senior, cpA)).debt).toMatchObject({ on: true, sum: SHORT + FEE });
        } finally {
          await f.t.admin.db
            .delete(schema.rolePermissions)
            .where(
              and(
                eq(schema.rolePermissions.roleId, f.roleIds.senior),
                inArray(schema.rolePermissions.permissionId, grants),
              ),
            );
        }
        // Выключено у организации.
        await orgDebt(f.a.orgId, false);
        expect((await card(owner, cpA)).debt).toMatchObject({
          on: false,
          orgOn: false,
          refusal: 'page_debt_org_off',
          sum: null,
        });
        await orgDebt(f.a.orgId, true);
        // Ни «Платы за обслуживание», ни «Учёта оплаты налогов» — строки нет.
        await features(f.a.orgId, { cppage: true, telegram: true });
        expect((await card(owner, cpA)).debt).toBeNull();
        await features(f.a.orgId, ALL_ON);
      });

      it('переключатель в карточке: вход, право, область, чужая организация, версия, история', async () => {
        const { version } = (await card(owner, cpA)).debt!;
        expect((await toggle(undefined, cpA, false, version)).status).toBe(401);
        const noRight = await toggle(acc, cpA, false, version);
        expect(noRight.status).toBe(403);
        expect((await failure(noRight)).code).toBe('page_debt_right');
        // Чужая организация и контрагент вне области — «не найдено».
        expect((await toggle(ownerB, cpA, false, version)).status).toBe(404);
        expect((await toggle(acc, cpEmpty, false, version)).status).toBe(404);
        expect((await toggle(owner, cpA, 'нет', version)).status).toBe(400);
        const stale = await toggle(owner, cpA, false, version + 5);
        expect(stale.status).toBe(409);
        expect((await failure(stale)).code).toBe('record_changed');
        // Выключено у организации — переключатель не работает.
        await orgDebt(f.a.orgId, false);
        const orgOff = await toggle(owner, cpA, false, version);
        expect(orgOff.status).toBe(409);
        expect((await failure(orgOff)).code).toBe('page_debt_org_off');
        await orgDebt(f.a.orgId, true);
        expect((await card(owner, cpA)).debt).toMatchObject({ on: true, version });

        const off = await toggle(owner, cpA, false, version);
        expect(off.status, await off.clone().text()).toBe(200);
        expect(ContractorTelegram.parse(await off.json()).debt).toMatchObject({
          on: false,
          orgOn: true,
          version: version + 1,
        });
        // Напоминание этому контрагенту не уходит.
        await runDebt();
        expect(tg.sent).toEqual([]);
        // История контрагента: «Напоминание о долге в Telegram: выключено», от имени сотрудника.
        const shown = await call(owner, 'GET', `/api/contractors/${cpA}/history`);
        expect(shown.status, await shown.clone().text()).toBe(200);
        const last = ContractorHistory.parse(await shown.json()).items.find((i) =>
          i.changes.some((c) => c.field === 'tgDebtOff'),
        );
        expect(last).toMatchObject({
          entity: 'contractor_page',
          action: 'update',
          changes: [{ field: 'tgDebtOff', from: false, to: true }],
        });
        const on = await toggle(owner, cpA, true, version + 1);
        expect(on.status).toBe(200);
        expect(ContractorTelegram.parse(await on.json()).debt).toMatchObject({ on: true });
      });
    });

    // Последним: чат клиента становится ещё и чатом сотрудника другой организации (общая сборка 13.11).
    it('чат, привязанный и к сотруднику: без ответа на просьбу текст — не вопрос клиента (п. О-79)', async () => {
      await sent(owner, cpA);
      await press(askData, CLIENT_1, tg.messageIds[0]!);
      const askId = lastMessageId(CLIENT_1);
      // Чат только клиента: команда без ответа на просьбу — не вопрос, в ответ — подсказка клиенту.
      await toBot('/today', CLIENT_1, 'client_one');
      expect(sentTo(CLIENT_1).at(-1)!.text).toContain('ОсОО «Ала-Тоо Трейд»');
      expect(sentTo(CLIENT_1).at(-1)!.text).not.toBe(text('tgStart'));
      await linkTelegram(f.app, ownerB, CLIENT_1, 'client_one');
      const questions = async () =>
        (await history(cpA)).filter((h) => h.action === 'page_tg_question');

      // Текст для бота сотрудника (команда, причина, просто текст) в организацию А не уходит.
      await toBot('/today', CLIENT_1, 'client_one');
      await toBot('Причина возврата отчёта', CLIENT_1, 'client_one');
      expect(await questions()).toEqual([]);
      // Ответом на просьбу бота — вопрос клиента, как обычно.
      await toBot('Вопрос по оплате', CLIENT_1, 'client_one', askId);
      expect(await questions()).toHaveLength(1);
    });
  },
);
