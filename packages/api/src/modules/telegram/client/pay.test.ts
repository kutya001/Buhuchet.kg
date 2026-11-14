import { fixedClock, parseCron, type FakeTelegram } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  botPressData,
  CP_TG_PAY_SENDS_PER_HOUR,
  CP_TG_QUESTIONS_PER_HOUR,
  fillTemplate,
  formatSomWithUnit,
  TELEGRAM_TEMPLATE_DEFAULTS,
  UI_TEXTS,
} from '@buhuchet/domain';
import {
  ApiError,
  ContractorHistory,
  ContractorMonthPay,
  ContractorMonthPaySent,
  ContractorPage,
  ContractorTelegram,
  PublicPageTelegramLink,
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
import { contractorDebtJob } from './debt';
import { contractorPayJob } from './pay';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type Report = typeof schema.reports.$inferInsert;

const som = formatSomWithUnit;
/** M-Bank — код refDB.json. */
const MBANK = 'БНК-13';
const REQUISITE = 'Перевод по номеру 0555 123 456 (M-Bank), получатель Бухгалтер А.';

/** Чаты сотрудников (привязаны к учётным записям) и чаты клиентов. */
const CHAT_ACC = 7001;
const CHAT_OWNER = 7002;
const CHAT_ACC_B = 7003;
const CLIENT_1 = 9001;
const CLIENT_2 = 9002;
const CLIENT_B = 9003;
const STRANGER = 9099;

/** Пока сотрудник не может ответить клиенту из Telegram (docs/deviations.md п. К-4). */
const PAID_HEADING = 'Контрагент сообщил об оплате';
const ASK_HEADING = 'Вопрос контрагента';
const NO_REPLY = 'Ответить клиенту из Telegram пока нельзя — свяжитесь с ним сами.';

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
      ).filter((h) => ['page_tg_pay', 'page_tg_paid', 'page_tg_question'].includes(h.action));
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
      await f.t.admin.db.delete(schema.contractorTelegramMessages);
      await f.t.admin.db.execute(
        sql`delete from audit_log where action in ('page_tg_pay', 'page_tg_paid', 'page_tg_question')`,
      );
      await f.t.admin.db.execute(sql`delete from rate_limits where kind = 'cp_tg_ask'`);
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
      expect((await pay(owner, cpA)).send).toEqual({ refusal: null, recipients: 2 });
      expect((await pay(chief, cpA)).send).toEqual({ refusal: null, recipients: 2 });
      // Бухгалтер: права «Управлять страницей контрагента» нет.
      expect((await pay(acc, cpA)).send).toEqual({
        refusal: 'month_pay_send_right',
        recipients: 2,
      });
      // Никто не подключил Telegram.
      expect((await pay(owner, cpEmpty)).send).toEqual({
        refusal: 'month_pay_send_not_linked',
        recipients: 0,
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
      // Чужих контрагентов и организаций в сообщении нет.
      expect(first!.text).not.toContain('Садыков');
      expect(first!.text).not.toContain('Бишкек');
      expect(first!.options?.keyboard).toEqual([
        [{ text: text('tgBtnCpReq'), copy: REQUISITE }],
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
            [{ text: text('tgBtnCpReq'), copy: REQUISITE }],
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

    it('раздел «Как оплатить» скрыт — реквизит клиенту не уходит и в Telegram', async () => {
      await f.t.admin.db
        .update(schema.contractorPages)
        .set({ hiddenSections: ['pay'] })
        .where(eq(schema.contractorPages.contractorId, cpA));
      try {
        expect(await sent(owner, cpA)).toEqual({ recipients: 2, delivered: 2 });
        for (const m of tg.sent) {
          expect(m.text).not.toContain('0555');
          expect(JSON.stringify(m.options ?? {})).not.toContain('0555');
          expect(m.options?.keyboard).toEqual([
            [
              { text: text('tgBtnCpPaid'), data: paidData },
              { text: text('tgBtnCpQ'), data: askData },
            ],
          ]);
        }
        expect(JSON.stringify(await messages(cpA))).not.toContain('0555');
      } finally {
        await f.t.admin.db
          .update(schema.contractorPages)
          .set({ hiddenSections: [] })
          .where(eq(schema.contractorPages.contractorId, cpA));
      }
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
        'Вопрос передан вашему бухгалтеру. Он свяжется с вами.',
      ]);
      expect(sentTo(CHAT_ACC).map((m) => m.text)).toEqual([
        `${ASK_HEADING}\nОсОО «Ала-Тоо Трейд»: вопрос от «@client_one». Можно оплатить частями? До 25 числа ${NO_REPLY}`,
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
        `${ASK_HEADING}\nОсОО «Бишкек»: вопрос от «@client_b». Вопрос организации Б ${NO_REPLY}`,
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

    it('само «К оплате» за 5 дней до срока: только при включённой настройке, один раз на месяц и чат', async () => {
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
        expect(tg.sent[0]!.options?.keyboard?.[0]).toEqual([
          { text: text('tgBtnCpReq'), copy: REQUISITE },
        ]);
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

    it('само «К оплате» уходит в 10:05 по Бишкеку', () => {
      // Расписания задач читаются по времени Бишкека (UTC+6): 10:05 в Бишкеке — это 04:05 UTC.
      const schedule = parseCron(contractorPayJob.cron);
      expect(schedule.matches(new Date('2026-10-18T04:05:00Z'))).toBe(true);
      expect(schedule.matches(new Date('2026-10-18T10:05:00Z'))).toBe(false);
      expect(schedule.matches(new Date('2026-10-17T22:05:00Z'))).toBe(false);
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
        expect(keyboard.map((row) => row.map((b) => b.text))).toEqual([
          [text('tgBtnCpReqTax')],
          [text('tgBtnCpReqFee')],
          [text('tgBtnCpNoDebt')],
        ]);
        expect(keyboard[0]![0]).toEqual({ text: text('tgBtnCpReqTax'), copy: REQUISITE });
        expect(keyboard[1]![0]).toMatchObject({
          copy: expect.stringContaining(FEE_REQUISITE_PART),
        });
        expect(keyboard[2]![0]).toEqual({ text: text('tgBtnCpNoDebt'), data: noDebtData });
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

      it('задача идёт каждый день в 10:00 по Бишкеку; не в понедельник новых напоминаний нет', async () => {
        // Расписания задач читаются по времени Бишкека (UTC+6).
        const schedule = parseCron(contractorDebtJob.cron);
        expect(schedule.matches(new Date('2026-10-19T04:00:00Z'))).toBe(true);
        expect(schedule.matches(new Date('2026-10-20T04:00:00Z'))).toBe(true);
        expect(schedule.matches(new Date('2026-10-19T10:00:00Z'))).toBe(false);
        for (const day of ['2026-10-18T04:00:00Z', TUESDAY, '2026-10-24T04:00:00Z']) {
          await runDebt(day);
        }
        expect(tg.sent).toEqual([]);
        expect(await messages(cpA)).toEqual([]);
        // Запуск понедельника догоняется во вторник утром (исполнитель стоял): день недели берётся
        // из расписания, а не по часам — напоминания этой недели создаются.
        await contractorDebtJob.run(
          { ...f.deps, clock: fixedClock('2026-10-20T02:00:00Z') },
          new Date(MONDAY),
        );
        expect(tg.sent.map((m) => m.chatId).sort()).toEqual([CLIENT_1, CLIENT_2].sort());
        expect((await messages(cpA)).map((r) => r.week)).toEqual([WEEK, WEEK]);
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
        expect(rows()[0]).toEqual([true, false, [text('tgBtnCpReqTax'), text('tgBtnCpNoDebt')]]);
        expect(tg.sent[0]!.text).toContain(text('tgCpDebt', { сумма: som(SHORT) }));
        await wipe();
        // «Деньги на налоги» скрыты — только долг за обслуживание.
        await hide(cpA, ['money']);
        await runDebt();
        expect(rows()[0]).toEqual([false, true, [text('tgBtnCpReqFee'), text('tgBtnCpNoDebt')]]);
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
        expect(rows()[0]).toEqual([true, false, [text('tgBtnCpReqTax'), text('tgBtnCpNoDebt')]]);
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
        expect(debt).toEqual({
          on: true,
          orgOn: true,
          refusal: null,
          sum: SHORT + FEE,
          version: expect.any(Number),
        });
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
