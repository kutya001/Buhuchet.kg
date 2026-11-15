import type { FakeTelegram, MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  fillTemplate,
  formatSomWithUnit,
  monthLabel,
  PAGE_CODE_TG_MAX,
  pageCodeText,
  TELEGRAM_TEMPLATE_DEFAULTS,
  UI_TEXTS,
} from '@buhuchet/domain';
import {
  ApiError,
  ContractorPage,
  ContractorTelegram,
  PageForgot,
  PageSentTicket,
  PublicPage,
  PublicPageTelegramLink,
  SentFileList,
} from '@buhuchet/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  apiRequest,
  createStaffFixture,
  linkTelegram,
  sendToBot,
  signIn,
  telegramUpdate,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../../testing';

/*
 * Страница контрагента: «Я оплатил», «По месяцам» с оплатой и код в Telegram (доработки 14.11.2026,
 * блок 6, этап 3, поток К; прототип v116 modules/cp-paid.js). Сегодня в тестах — 18.10.2026.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type Report = typeof schema.reports.$inferInsert;

const MBANK = 'БНК-13';
const INN_A = '03744097401851';
const INN_B = '03744097401852';
const CP_A = 'ОсОО «Ала-Тоо Трейд»';
const CP_B = 'ОсОО «Бишкек»';
/** Контрагент без подключённого Telegram. */
const INN_A2 = '03744097401853';
const MONTHLY = 300_000;
const CHAT_ACC = 7301;
const CHAT_OWNER = 7302;
/** Клиент «Ала-Тоо Трейд» и «Бишкек» (организации А и Б). */
const CLIENT_1 = 9301;
/** Чат ни к кому не подключён. */
const STRANGER = 9399;

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc('%PDF-1.7\nчек');
const tpl = (key: keyof typeof TELEGRAM_TEMPLATE_DEFAULTS, v: Record<string, string | number>) =>
  fillTemplate(TELEGRAM_TEMPLATE_DEFAULTS[key], v);

describe.skipIf(!databaseAvailable())(
  'Страница контрагента: «Я оплатил» и код в Telegram (доработки 14.11.2026, блок 6; прототип v116)',
  () => {
    let f: Fixture;
    let tg: FakeTelegram;
    let storage: MemoryStorage;
    let owner: string;
    let ownerB: string;
    let acc: string;
    let cpA = '';
    let cpB = '';
    let cpA2 = '';
    let grantA = '';
    let grantB = '';

    const employee = (login: string) => f.people[login]!.employeeId;
    const call = (
      cookie: string | undefined,
      method: 'GET' | 'POST',
      path: string,
      body?: unknown,
    ) => apiRequest(f.app, method, path, cookie, body);
    const failure = async (res: Response) => ApiError.parse(await res.json()).error;
    const features = (orgId: string, value: Record<string, boolean>) =>
      f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: value })
        .where(eq(schema.orgSettings.orgId, orgId));
    const ON = { cppage: true, telegram: true, taxpay: true, fee: true, files: true };

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
          feeDay: 20,
          responsibleEmployeeId: responsible,
          createdAt: new Date('2026-06-20T10:00:00+06:00'),
        })
        .returning({ id: schema.contractors.id });
      await f.t.admin.db.insert(schema.contractorTariffs).values({
        orgId,
        contractorId: row!.id,
        amount: MONTHLY,
        period: 'M',
        validFrom: '2026-07-01',
      });
      return row!.id;
    }
    const report = (orgId: string, values: Omit<Report, 'orgId'>) =>
      f.t.admin.db.insert(schema.reports).values({ orgId, ...values });

    /** Включить страницу и ввести код в «браузере»: cookie страницы. */
    async function grant(cookie: string, cp: string, inn: string, slug: string) {
      const page = await call(cookie, 'GET', `/api/contractors/${cp}/page`);
      let code = ContractorPage.parse(await page.json()).code;
      if (!code) {
        const on = await call(cookie, 'POST', `/api/contractors/${cp}/page/enable`);
        expect(on.status, await on.clone().text()).toBe(200);
        code = ContractorPage.parse(await on.json()).code;
      }
      const res = await f.app.request(`/api/page/${slug}/${inn}/code`, {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      expect(res.status, await res.clone().text()).toBe(200);
      return {
        cookie: (res.headers.get('set-cookie') ?? '').split(';')[0]!,
        raw: res,
        code: code!,
      };
    }
    /** Подключить чат клиента к контрагенту: ссылка со страницы, «Старт», «Подтвердить». */
    async function linkClient(cookie: string, cp: string, inn: string, slug: string, chat: number) {
      const g = await grant(cookie, cp, inn, slug);
      const link = await f.app.request(`/api/page/${slug}/${inn}/telegram`, {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, cookie: g.cookie },
      });
      expect(link.status, await link.clone().text()).toBe(200);
      const token = new URL(PublicPageTelegramLink.parse(await link.json()).url).searchParams.get(
        'start',
      )!;
      expect((await sendToBot(f.app, telegramUpdate(`/start ${token}`, chat))).status).toBe(200);
      const list = await call(cookie, 'GET', `/api/contractors/${cp}/page/telegram`);
      const row = ContractorTelegram.parse(await list.json()).items.find(
        (x) => x.status === 'wait',
      )!;
      const ok = await call(cookie, 'POST', `/api/contractors/${cp}/page/telegram/${row.id}`, {
        action: 'approve',
        version: row.version,
      });
      expect(ok.status, await ok.clone().text()).toBe(200);
    }
    const pagePost = (path: string, cookie: string | undefined, body?: unknown) =>
      f.app.request(path, {
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const publicPage = async (slug: string, inn: string, cookie: string) => {
      const res = await f.app.request(`/api/page/${slug}/${inn}`, { headers: { cookie } });
      const body = PublicPage.parse(await res.json());
      if (body.state !== 'open') throw new Error(`страница: ${body.state}`);
      return body.page;
    };
    type Paid = {
      purpose: 'tax' | 'fee';
      month: string | null;
      amount: number;
      comment?: string;
      file?: { name: string; size: number };
    };
    const paidStart = (cookie: string | undefined, o: Paid) =>
      pagePost(`/api/page/org-a/${INN_A}/paid`, cookie, {
        purpose: o.purpose,
        month: o.month,
        amount: o.amount,
        ...(o.comment === undefined ? {} : { comment: o.comment }),
        file: o.file ?? { name: 'Чек.pdf', size: PDF.length },
      });
    /** «Я оплатил» целиком: начать, положить чек по ссылке, закончить. */
    const paid = async (cookie: string, o: Paid, complete: Partial<Paid> = {}) => {
      const res = await paidStart(cookie, o);
      expect(res.status, await res.clone().text()).toBe(201);
      const [item] = PageSentTicket.parse(await res.json()).items;
      const url = new URL(item!.upload.url);
      await storage.put(url.host + url.pathname, PDF, {
        contentType: item!.upload.headers['content-type']!,
      });
      const { file: _file, ...rest } = { ...o, ...complete };
      return {
        id: item!.id,
        res: await pagePost(`/api/page/org-a/${INN_A}/paid/complete`, cookie, {
          ...rest,
          id: item!.id,
        }),
      };
    };
    const forgot = (slug: string, inn: string) =>
      pagePost(`/api/page/${slug}/${inn}/forgot`, undefined);
    const forgotOutcome = async (slug: string, inn: string) => {
      const res = await forgot(slug, inn);
      expect(res.status, await res.clone().text()).toBe(200);
      return PageForgot.parse(await res.json());
    };
    const claims = (cp: string) =>
      f.t.admin.db
        .select({
          source: schema.contractorPayClaims.source,
          purpose: schema.contractorPayClaims.purpose,
          month: schema.contractorPayClaims.month,
          amount: schema.contractorPayClaims.amount,
          comment: schema.contractorPayClaims.comment,
          sentFileId: schema.contractorPayClaims.sentFileId,
          status: schema.contractorPayClaims.status,
        })
        .from(schema.contractorPayClaims)
        .where(eq(schema.contractorPayClaims.contractorId, cp))
        .orderBy(asc(schema.contractorPayClaims.createdAt));
    const history = (cp: string, action: string) =>
      f.t.admin.db
        .select({ changes: schema.auditLog.changes, userId: schema.auditLog.actorUserId })
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.contractorId, cp), eq(schema.auditLog.action, action)))
        .orderBy(asc(schema.auditLog.at), asc(schema.auditLog.id));
    const sentTo = (chatId: number) => tg.sent.filter((m) => m.chatId === chatId);
    const codeCommand = (chatId: number, text = '/code') =>
      sendToBot(f.app, telegramUpdate(text, chatId));
    const setPage = (cp: string, values: Partial<typeof schema.contractorPages.$inferInsert>) =>
      f.t.admin.db
        .update(schema.contractorPages)
        .set(values)
        .where(eq(schema.contractorPages.contractorId, cp));

    beforeAll(async () => {
      f = await createStaffFixture();
      tg = f.deps.telegram as FakeTelegram;
      storage = f.deps.storage as MemoryStorage;
      await seedAllPlatformDictionaries(f.t.admin.db);
      await features(f.a.orgId, ON);
      await features(f.b.orgId, ON);
      [owner, ownerB, acc] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'owner-b', TEST_PASSWORD),
        signIn(f.app, 'acc-a', TEST_PASSWORD),
      ]);
      for (const cookie of [owner, ownerB]) {
        const res = await call(cookie, 'POST', '/api/org-report-types/connect', {
          connect: ['nds', 'pat'],
          disconnect: [],
        });
        expect(res.status, await res.clone().text()).toBe(200);
      }
      cpA = await contractor(f.a.orgId, CP_A, INN_A, employee('acc-a'));
      cpB = await contractor(f.b.orgId, CP_B, INN_B, employee('acc-b'));
      cpA2 = await contractor(f.a.orgId, 'ИП Садыков', INN_A2, employee('acc-a'));
      // Реквизит ответственного — для налогов (контрагент переводит сотруднику), счёт организации — для
      // обслуживания: «Как оплатить» показывает обе карточки.
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
      const sep = { period: 'M' as const, periodStart: '2026-09-01' };
      const mine = { contractorId: cpA, responsibleEmployeeId: employee('acc-a'), ...sep };
      // Сентябрь: НДС оплачен частично (1 200 из 5 000), патент не оплачен.
      await report(f.a.orgId, {
        ...mine,
        reportTypeCode: 'nds',
        act: 'both',
        dueBase: '2026-10-20',
        dueDate: '2026-10-20',
        payDue: '2026-10-25',
        amount: 500_000,
        paid: 120_000,
      });
      await report(f.a.orgId, {
        ...mine,
        reportTypeCode: 'pat',
        act: 'pay',
        dueBase: '2026-10-20',
        dueDate: '2026-10-20',
        payDue: '2026-10-20',
        amount: 87_050,
      });
      await linkTelegram(f.app, acc, CHAT_ACC, 'acc_a');
      await linkTelegram(f.app, owner, CHAT_OWNER, 'owner_a');
      grantA = (await grant(owner, cpA, INN_A, 'org-a')).cookie;
      grantB = (await grant(ownerB, cpB, INN_B, 'org-b')).cookie;
      await grant(owner, cpA2, INN_A2, 'org-a');
      await linkClient(owner, cpA, INN_A, 'org-a', CLIENT_1);
    });

    beforeEach(async () => {
      await f.t.admin.db.delete(schema.contractorPayClaims);
      await f.t.admin.db.delete(schema.contractorSentFiles);
      await f.t.admin.db.delete(schema.moneyOperations);
      await f.t.admin.db.delete(schema.telegramOutbox);
      await f.t.admin.db.execute(
        sql`delete from rate_limits where kind like 'cp_sent%' or kind like 'cp_code%' or kind like 'cp_tg_code%' or kind = 'cp_forgot_ip'`,
      );
      await f.t.admin.db.update(schema.contractorPages).set({
        filesUpload: true,
        hiddenSections: [],
        closedAt: null,
      });
      tg.sent.length = 0;
      tg.messageIds.length = 0;
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('«По месяцам»: к оплате, оплачено, осталось и пометка; «Как оплатить» — подпись реквизита и «ждёт» нет', async () => {
      const page = await publicPage('org-a', INN_A, grantA);
      const month = page.reports!.months!;
      expect(month).toHaveLength(1);
      expect(month[0]).toMatchObject({
        sum: 587_050,
        got: 120_000,
        left: 467_050,
        status: 'partial',
      });
      // «Перечислить» — строки с остатком от раннего срока оплаты.
      expect(month[0]!.rows.map((r) => r.left)).toEqual([87_050, 380_000]);
      expect(page.reports!.send).toBe(true);
      expect(page.reports!.items.every((x) => x.month === month[0]!.month)).toBe(true);
      expect(page.pay?.tax).toMatchObject({ waiting: null });
      expect(page.pay?.tax?.head).toContain('Сотрудник acc-a');
      expect(page.pay?.tax?.copy).toBe('0555123456');
      // Свободный остаток (поступление без детализации по отчётам) в «оплачено» не входит: прототип
      // `pgMonthPay` берёт принятое под отчёт (`r.recv`), а не «Получено от контрагента» по сверке.
      await f.t.admin.db.insert(schema.moneyOperations).values({
        orgId: f.a.orgId,
        contractorId: cpA,
        kind: 'in',
        amount: 100_000,
        total: 100_000,
        opDate: '2026-10-18',
        holderKind: 'org',
      });
      expect((await publicPage('org-a', INN_A, grantA)).reports!.months![0]).toMatchObject({
        got: 120_000,
        left: 467_050,
      });
      // Без «Учёта оплаты налогов» месяцев с оплатой нет.
      await features(f.a.orgId, { ...ON, taxpay: false });
      try {
        const off = await publicPage('org-a', INN_A, grantA);
        expect(off.reports!.months).toBeNull();
        expect(off.reports!.send).toBe(false);
      } finally {
        await features(f.a.orgId, ON);
      }
    });

    it('приёмка: «Я оплатил» без чека не отправляется; с чеком у месяца «Ожидает подтверждения», после «Принять деньги» — «Оплачено»', async () => {
      const page = await publicPage('org-a', INN_A, grantA);
      const month = page.reports!.months![0]!.month;
      // Без чека — 400 по схеме, неверный чек — поле «Чек».
      const none = await pagePost(`/api/page/org-a/${INN_A}/paid`, grantA, {
        purpose: 'tax',
        month,
        amount: 467_050,
      });
      expect(none.status).toBe(400);
      const xlsx = await paidStart(grantA, {
        purpose: 'tax',
        month,
        amount: 467_050,
        file: { name: 'Выписка.xlsx', size: 100 },
      });
      expect(xlsx.status).toBe(400);
      expect(await failure(xlsx)).toMatchObject({
        code: 'page_paid_invalid',
        details: { field: 'file', problem: 'file_type' },
      });
      const zero = await paidStart(grantA, { purpose: 'tax', month, amount: 0 });
      expect(await failure(zero)).toMatchObject({ details: { field: 'sum', problem: 'sum' } });
      const other = await paidStart(grantA, { purpose: 'tax', month: '2026-03', amount: 100 });
      expect(await failure(other)).toMatchObject({ details: { field: 'month', problem: 'month' } });
      expect(await claims(cpA)).toEqual([]);

      const done = await paid(grantA, {
        purpose: 'tax',
        month,
        amount: 467_050,
        comment: '  перевёл   с карты ',
      });
      expect(done.res.status, await done.res.clone().text()).toBe(200);
      expect(await claims(cpA)).toEqual([
        {
          source: 'page',
          purpose: 'tax',
          month,
          amount: 467_050,
          comment: 'перевёл с карты',
          sentFileId: done.id,
          status: 'wait',
        },
      ]);
      // Чек — «Новый» в «Отправленных файлах» с комментарием «Чек: налоги за <месяц>. …» без суммы:
      // список видят и те, кому сумма налогов не положена (п. К-14).
      const listed = await (await call(acc, 'GET', `/api/contractors/${cpA}/sent-files`)).json();
      const list = SentFileList.parse(listed);
      expect(list.items.map((x) => [x.name, x.status, x.comment])).toEqual([
        ['Чек.pdf', 'new', `Чек: налоги за ${monthLabel(month).toLowerCase()}. перевёл с карты`],
      ]);
      expect(JSON.stringify(listed)).not.toContain(formatSomWithUnit(467_050));
      // История — одна запись от имени контрагента, без автора.
      expect(await history(cpA, 'page_paid')).toEqual([
        {
          userId: null,
          changes: [
            {
              field: 'pagePaid',
              to: {
                purpose: 'tax',
                month,
                amount: 467_050,
                file: 'Чек.pdf',
                note: 'перевёл с карты',
              },
            },
          ],
        },
      ]);
      expect(await history(cpA, 'sent_file_send')).toEqual([]);
      // Ответственному — «Контрагент сообщил об оплате».
      const staff = sentTo(CHAT_ACC);
      expect(staff).toHaveLength(1);
      expect(staff[0]!.text).toContain(UI_TEXTS['cppage.tg.staff.paid_heading'].ru);
      expect(staff[0]!.text).toContain('налогов за ');
      expect(staff[0]!.text).toContain(formatSomWithUnit(467_050));

      const waiting = await publicPage('org-a', INN_A, grantA);
      expect(waiting.reports!.months![0]!.status).toBe('wait');
      expect(waiting.pay?.tax?.waiting).toMatchObject({ amount: 467_050 });

      // Бухгалтер принял деньги (поступление на налоги после сообщения) и оплатил отчёты — «Оплачено».
      await f.t.admin.db.insert(schema.moneyOperations).values({
        orgId: f.a.orgId,
        contractorId: cpA,
        kind: 'in',
        amount: 467_050,
        total: 467_050,
        opDate: '2026-10-18',
        holderKind: 'org',
      });
      await f.t.admin.db
        .update(schema.reports)
        .set({ paid: sql`${schema.reports.amount}` })
        .where(eq(schema.reports.contractorId, cpA));
      try {
        const after = await publicPage('org-a', INN_A, grantA);
        expect(after.reports!.months![0]).toMatchObject({ status: 'paid', left: 0 });
        expect(after.pay?.tax?.waiting).toBeNull();
      } finally {
        await f.t.admin.db
          .update(schema.reports)
          .set({ paid: 0 })
          .where(eq(schema.reports.reportTypeCode, 'pat'));
        await f.t.admin.db
          .update(schema.reports)
          .set({ paid: 120_000 })
          .where(eq(schema.reports.reportTypeCode, 'nds'));
      }
    });

    it('отклонённый чек — сообщение об оплате тоже отклонено: у месяца снова «Частично»', async () => {
      const month = (await publicPage('org-a', INN_A, grantA)).reports!.months![0]!.month;
      const done = await paid(grantA, { purpose: 'tax', month, amount: 100_000 });
      expect(done.res.status, await done.res.clone().text()).toBe(200);
      const [file] = SentFileList.parse(
        await (await call(owner, 'GET', `/api/contractors/${cpA}/sent-files`)).json(),
      ).items;
      const rej = await call(owner, 'POST', `/api/files/sent/${file!.id}/reject`, {
        version: file!.version,
        reason: 'Чек не читается',
      });
      expect(rej.status, await rej.clone().text()).toBe(200);
      expect((await claims(cpA)).map((x) => x.status)).toEqual(['rejected']);
      expect((await publicPage('org-a', INN_A, grantA)).reports!.months![0]!.status).toBe(
        'partial',
      );
    });

    it('«Я оплатил» за обслуживание: месяц с долгом, «Ожидает подтверждения» у месяца; сумма — тому, кто видит плату', async () => {
      const page = await publicPage('org-a', INN_A, grantA);
      const open = page.fee!.months.filter((m) => m.charge - m.got > 0).map((m) => m.month);
      const oldest = [...open].sort()[0]!;
      const done = await paid(grantA, { purpose: 'fee', month: oldest, amount: MONTHLY });
      expect(done.res.status, await done.res.clone().text()).toBe(200);
      const after = await publicPage('org-a', INN_A, grantA);
      expect(after.fee!.months.find((m) => m.month === oldest)!.status).toBe('wait');
      expect(after.pay?.fee?.waiting).toMatchObject({ amount: MONTHLY });
      expect((await history(cpA, 'page_paid')).at(-1)!.changes).toEqual([
        expect.objectContaining({ field: 'pagePaidFee' }),
      ]);
      // У бухгалтера нет права «Видеть плату за обслуживание» — сообщение владельцу.
      expect(sentTo(CHAT_ACC)).toEqual([]);
      expect(sentTo(CHAT_OWNER)).toHaveLength(1);
      expect(sentTo(CHAT_OWNER)[0]!.text).toContain('обслуживания за ');
    });

    it('что можно сообщить считает сервер: скрытый «Как оплатить», выключенная отправка файлов, чужой чек, без кода', async () => {
      const month = (await publicPage('org-a', INN_A, grantA)).reports!.months![0]!.month;
      // Другой месяц при «закончить» — не тот чек (сумму заново проверяет сервер, как при «начать»).
      const swapped = await paid(
        grantA,
        { purpose: 'tax', month, amount: 100_000 },
        { month: null },
      );
      expect(swapped.res.status).toBe(404);
      const zero = await paid(grantA, { purpose: 'tax', month, amount: 100_000 }, { amount: 0 });
      expect(await failure(zero.res)).toMatchObject({ details: { field: 'sum', problem: 'sum' } });
      expect(await claims(cpA)).toEqual([]);
      // Без «Отчётов» месяцев налогов нет — только «без месяца».
      await setPage(cpA, { hiddenSections: ['reports'] });
      const hidden = await paidStart(grantA, { purpose: 'tax', month, amount: 100 });
      expect(await failure(hidden)).toMatchObject({ details: { field: 'month' } });
      expect((await paidStart(grantA, { purpose: 'tax', month: null, amount: 100 })).status).toBe(
        201,
      );
      // «Как оплатить» скрыт — «Я оплатил» нет.
      await setPage(cpA, { hiddenSections: ['pay'] });
      const noPay = await paidStart(grantA, { purpose: 'tax', month, amount: 100 });
      expect(noPay.status).toBe(404);
      expect((await failure(noPay)).code).toBe('page_unavailable');
      await setPage(cpA, { hiddenSections: [], filesUpload: false });
      const off = await paidStart(grantA, { purpose: 'tax', month, amount: 100 });
      expect(off.status).toBe(409);
      expect((await failure(off)).code).toBe('page_paid_off');
      await setPage(cpA, { filesUpload: true });
      // Без кода этого браузера и с cookie другой страницы — «Страница недоступна».
      expect((await paidStart(undefined, { purpose: 'tax', month, amount: 100 })).status).toBe(404);
      expect((await paidStart(grantB, { purpose: 'tax', month, amount: 100 })).status).toBe(404);
    });

    it('код запоминается в браузере на 1 день', async () => {
      const g = await grant(owner, cpA, INN_A, 'org-a');
      expect(g.raw.headers.get('set-cookie')).toMatch(/Max-Age=86400/);
    });

    it('приёмка: «Забыли код? Прислать в Telegram» — код пришёл в подключённый Telegram, четвёртый раз за сутки не приходит', async () => {
      // Telegram не подключён — «спросите код у бухгалтера».
      expect(await forgotOutcome('org-a', INN_A2)).toEqual({
        outcome: 'none',
        limit: PAGE_CODE_TG_MAX,
      });
      expect(await history(cpA2, 'page_code_tg')).toEqual([]);
      const code = ContractorPage.parse(
        await (await call(owner, 'GET', `/api/contractors/${cpA}/page`)).json(),
      ).code!;
      tg.sent.length = 0;
      expect((await forgotOutcome('org-a', INN_A)).outcome).toBe('sent');
      const [msg] = sentTo(CLIENT_1);
      expect(msg!.text).toBe(
        tpl('tgCpCode', {
          контрагент: CP_A,
          код: pageCodeText(code),
          ссылка: `${f.deps.config.APP_BASE_URL}/org-a/inn/${INN_A}`,
        }),
      );
      // Код моноширинным, «Скопировать код» копирует 6 цифр.
      expect(msg!.options.code).toBe(pageCodeText(code));
      expect(msg!.options.keyboard).toEqual([[expect.objectContaining({ copy: code })]]);
      // Код — мимо журнала отправок; в истории — куда и как, без кода.
      const outbox = await f.t.admin.db.select().from(schema.telegramOutbox);
      expect(JSON.stringify(outbox)).not.toContain(code);
      const h = await history(cpA, 'page_code_tg');
      expect(h.at(-1)).toEqual({
        userId: null,
        changes: [{ field: 'tgCode', to: { chats: [expect.any(String)], via: 'page' } }],
      });
      expect(JSON.stringify(h)).not.toContain(code);
      // Ещё два — по ссылке и командой бота, четвёртый — «уже присылали 3 раза».
      expect((await forgotOutcome('org-a', INN_A)).outcome).toBe('sent');
      expect((await codeCommand(CLIENT_1)).status).toBe(200);
      expect(sentTo(CLIENT_1)).toHaveLength(3);
      expect((await history(cpA, 'page_code_tg')).at(-1)!.changes).toEqual([
        { field: 'tgCode', to: { chats: [expect.any(String)], via: 'cmd' } },
      ]);
      expect(await forgotOutcome('org-a', INN_A)).toEqual({
        outcome: 'limit',
        limit: PAGE_CODE_TG_MAX,
      });
      await codeCommand(CLIENT_1, 'Код от страницы');
      expect(sentTo(CLIENT_1)).toHaveLength(4);
      expect(sentTo(CLIENT_1).at(-1)!.text).toBe(
        tpl('tgCpCodeLimit', { контрагент: CP_A, лимит: PAGE_CODE_TG_MAX }),
      );
      expect(await history(cpA, 'page_code_tg')).toHaveLength(3);
    });

    it('«Забыли код?»: закрытая страница, скрытый «Telegram», неизвестный адрес; ответ без кода и чатов', async () => {
      await setPage(cpA, { closedAt: new Date() });
      expect((await forgotOutcome('org-a', INN_A)).outcome).toBe('closed');
      await codeCommand(CLIENT_1);
      expect(sentTo(CLIENT_1).at(-1)!.text).toBe(tpl('tgCpCodeClosed', { контрагент: CP_A }));
      await setPage(cpA, { closedAt: null, hiddenSections: ['tg'] });
      expect((await forgotOutcome('org-a', INN_A)).outcome).toBe('none');
      await setPage(cpA, { hiddenSections: [] });
      for (const [slug, inn] of [
        ['org-a', INN_B],
        ['nope', INN_A],
        ['org-a', '123'],
      ] as const) {
        const res = await forgot(slug, inn);
        expect(res.status).toBe(404);
        expect((await failure(res)).code).toBe('page_unavailable');
      }
      expect(sentTo(CLIENT_1)).toHaveLength(1);
    });

    it('команда «Код от страницы»: по сообщению на каждую страницу чата — каждая в своей организации; чужой чат — «спросите у бухгалтера»; повтор доставки не отвечает', async () => {
      await linkClient(ownerB, cpB, INN_B, 'org-b', CLIENT_1);
      tg.sent.length = 0;
      const update = telegramUpdate('/code@buhuchet_test_bot', CLIENT_1);
      expect((await sendToBot(f.app, update)).status).toBe(200);
      const texts = sentTo(CLIENT_1).map((m) => m.text);
      expect(texts).toHaveLength(2);
      expect(texts.some((x) => x.includes(CP_A) && x.includes('/org-a/inn/'))).toBe(true);
      expect(texts.some((x) => x.includes(CP_B) && x.includes('/org-b/inn/'))).toBe(true);
      // Telegram повторил то же сообщение — второй раз кода нет.
      await sendToBot(f.app, update);
      expect(sentTo(CLIENT_1)).toHaveLength(2);
      // Чат без подключений — «спросите код у бухгалтера».
      await codeCommand(STRANGER);
      expect(sentTo(STRANGER).at(-1)!.text).toBe(tpl('tgCpCodeNone', {}));
      expect(await history(cpB, 'page_code_tg')).toHaveLength(1);
      // Чат сотрудника без подключений к страницам — команду разбирает бот сотрудника (п. О-79).
      await codeCommand(CHAT_ACC);
      expect(sentTo(CHAT_ACC).map((m) => m.text)).not.toContain(tpl('tgCpCodeNone', {}));
    });

    it('«Забыли код?» с одного адреса — не больше 10 в час, неизвестные адреса тоже считаются', async () => {
      for (let i = 0; i < 10; i++) expect((await forgot('nope', INN_A)).status).toBe(404);
      const res = await forgot('org-a', INN_A);
      expect(res.status).toBe(429);
      expect((await failure(res)).code).toBe('page_forgot_limit');
      expect(sentTo(CLIENT_1)).toEqual([]);
    });
  },
);
