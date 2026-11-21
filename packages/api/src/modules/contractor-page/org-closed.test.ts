import { fixedClock, type FakeTelegram, type MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  botPressData,
  CP_TG_FILE_TO_ACTION,
  fillTemplate,
  formatText,
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
  SubscriptionPayDone,
  SubscriptionUploadTicket,
} from '@buhuchet/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  apiRequest,
  createStaffFixture,
  sendToBot,
  signIn,
  telegramPress,
  telegramUpdate,
  TEST_ORIGIN,
  TEST_PASSWORD,
  TEST_SUBSCRIPTION,
} from '../../testing';
import { contractorDebtJob } from '../telegram/client/debt';

/*
 * Этап 2, П8 общего плана 20.11 (задача-проверка потока К): старые кнопки и ссылки клиентов при
 * закрытом и снова открытом доступе организации — доработки 20.11.2026, блок 4, пункты 4–6; «Как
 * проверить…»: «На следующий день после «Оплачено до» без оплаты…», «Владелец закрытой организации
 * прикрепляет чек: доступ открыт сразу…», «Администратор отклоняет чек с причиной…». Кнопки под
 * сообщениями, ушедшими до закрытия («Оплатил», «Вопрос бухгалтеру», «Прислать чек», «От какой
 * компании?», «Не напоминать», «Показать реквизиты для перевода»), команда «Код от страницы», страница
 * по ссылке, «Забыли код?» и «Я оплатил» проходят через одну проверку базы `app.org_usage`; здесь — что
 * каждый вход отвечает так же на каждом шаге: срок прошёл, чек на проверке, чек отклонён, новый чек
 * после отклонения, оплата подтверждена, «Нет подписки» (п. К-24). Оплату ведут настоящие методы
 * владельца («Подписка» → чек) и администратора платформы («Подтвердить» / «Отклонить»).
 * Сегодня в тестах — воскресенье, 18.10.2026; напоминание о долге уходит в понедельник, 19.10.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type Report = typeof schema.reports.$inferInsert;

const MBANK = 'БНК-13';
const INN_A = '03744097401851';
const INN_A2 = '03744097401853';
const INN_B = '03744097401852';
const CP_A = 'ОсОО «Ала-Тоо Трейд»';
const SEP = '2026-09';
/** Остаток налогов сентября: НДС 5 000 − 1 200 и патент 870,50. */
const SEP_TOTAL = 467_050;
const MONDAY = '2026-10-19T04:00:00Z';
/** Подключён к «Ала-Тоо Трейд» (организация А) и «Бишкек» (организация Б). */
const CLIENT_1 = 9501;
/** Подключён к «Ала-Тоо Трейд» и «Ош Строй» (обе — организация А): файл без просьбы — «От какой компании?». */
const CLIENT_2 = 9502;

const CLOSED = UI_TEXTS['cppage.tg.org_closed'].ru;
/** Номера реквизитов в сообщении «Реквизиты для перевода»: ответственного (налоги) и организации (обслуживание). */
const TAX_REQUISITE_PART = '0555 123 456';
const FEE_REQUISITE_PART = '0555 987 654';
const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc('%PDF-1.7\nчек');
const tpl = (
  key: keyof typeof TELEGRAM_TEMPLATE_DEFAULTS,
  v: Record<string, string | number> = {},
) => fillTemplate(TELEGRAM_TEMPLATE_DEFAULTS[key], v);
const closedCode = (contractor: string) =>
  formatText(UI_TEXTS['cppage.tg.org_closed_code'].ru, { contractor });

/** Кнопка старого сообщения: чат, номер сообщения в нём и что пришлёт нажатие. */
type OldButton = { name: string; chatId: number; messageId: number; data: string };

describe.skipIf(!databaseAvailable())(
  'Этап 2, П8: старые кнопки и ссылки клиентов при закрытом и снова открытом доступе (доработки 20.11.2026, блок 4, пункты 4–6)',
  () => {
    let f: Fixture;
    let tg: FakeTelegram;
    let storage: MemoryStorage;
    let owner: string;
    let ownerB: string;
    let admin: string;
    let cpA = '';
    let cpA2 = '';
    let cpB = '';
    let grantA = '';
    let codeA = '';
    let codeB = '';

    const employee = (login: string) => f.people[login]!.employeeId;
    const call = (
      cookie: string | undefined,
      method: 'GET' | 'POST',
      path: string,
      body?: unknown,
    ) => apiRequest(f.app, method, path, cookie, body);
    const failure = async (res: Response) => ApiError.parse(await res.json()).error;
    const features = (orgId: string) =>
      f.t.admin.db
        .update(schema.orgSettings)
        .set({
          features: { cppage: true, telegram: true, taxpay: true, fee: true, files: true },
          cpTgDebt: orgId === f.a.orgId,
        })
        .where(eq(schema.orgSettings.orgId, orgId));

    async function contractor(
      orgId: string,
      name: string,
      inn: string,
      responsible: string,
      monthly: number | null,
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
          startDate: '2026-01-15',
          feeDay: 20,
          responsibleEmployeeId: responsible,
          // Начисления — с месяца создания: «создан» в июне, чтобы был долг за обслуживание.
          createdAt: new Date('2026-06-20T10:00:00+06:00'),
        })
        .returning({ id: schema.contractors.id });
      if (monthly !== null) {
        await f.t.admin.db.insert(schema.contractorTariffs).values({
          orgId,
          contractorId: row!.id,
          amount: monthly,
          period: 'M',
          validFrom: '2026-07-01',
        });
      }
      return row!.id;
    }
    const report = (values: Omit<Report, 'orgId'>) =>
      f.t.admin.db.insert(schema.reports).values({ orgId: f.a.orgId, ...values });

    /** Включить страницу и ввести код в «браузере»: cookie страницы и её код. */
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
      return { cookie: (res.headers.get('set-cookie') ?? '').split(';')[0]!, code: code! };
    }
    /** Подключить чат клиента к контрагенту: ссылка со страницы, «Старт», «Подтвердить». */
    async function linkClient(cookie: string, cp: string, inn: string, slug: string, chat: number) {
      const g = await grant(cookie, cp, inn, slug);
      const link = await pagePost(`/api/page/${slug}/${inn}/telegram`, g.cookie);
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
      return g;
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
    const readPage = (cookie?: string) =>
      f.app.request(`/api/page/org-a/${INN_A}`, { headers: cookie ? { cookie } : {} });
    const pageState = async (cookie?: string) =>
      PublicPage.parse(await (await readPage(cookie)).json());
    /** Ответ страницы как есть, без разбора схемой: лишнее поле в ответе тоже заметно. */
    const pageRaw = async (cookie?: string): Promise<unknown> => (await readPage(cookie)).json();
    const forgot = async (): Promise<unknown> => {
      const res = await pagePost(`/api/page/org-a/${INN_A}/forgot`, undefined);
      expect(res.status, await res.clone().text()).toBe(200);
      const body: unknown = await res.json();
      PageForgot.parse(body);
      return body;
    };
    const PAID_TAX = { purpose: 'tax' as const, month: SEP, amount: SEP_TOTAL };
    /** «Я оплатил» на странице: начать и положить чек по ссылке загрузки (закончить — отдельно). */
    const paidBegin = async () => {
      const res = await pagePost(`/api/page/org-a/${INN_A}/paid`, grantA, {
        ...PAID_TAX,
        file: { name: 'Чек.pdf', size: PDF.length },
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const [item] = PageSentTicket.parse(await res.json()).items;
      const url = new URL(item!.upload.url);
      await storage.put(url.host + url.pathname, PDF, {
        contentType: item!.upload.headers['content-type']!,
      });
      return item!.id;
    };
    const paidComplete = (id: string) =>
      pagePost(`/api/page/org-a/${INN_A}/paid/complete`, grantA, { ...PAID_TAX, id });

    const toBot = async (body: string, chatId: number) => {
      expect((await sendToBot(f.app, telegramUpdate(body, chatId))).status).toBe(200);
    };
    const press = async (data: string, chatId: number, messageId: number) => {
      const before = tg.answers.length;
      expect((await sendToBot(f.app, telegramPress(data, chatId, messageId))).status).toBe(200);
      return tg.answers.length > before ? tg.answers.at(-1) : undefined;
    };
    const sendFile = async (chatId: number, name: string) => {
      const fileId = `tg-file-${tg.files.size + 1}`;
      tg.files.set(fileId, PDF);
      const update = telegramUpdate(null, chatId, {
        document: { fileId, name, size: PDF.byteLength },
      });
      expect((await sendToBot(f.app, update)).status).toBe(200);
    };
    const sentTo = (chatId: number) => tg.sent.filter((m) => m.chatId === chatId);
    const lastMessageId = (chatId: number) => {
      const i = tg.sent.map((m) => m.chatId).lastIndexOf(chatId);
      return tg.messageIds[i]!;
    };
    /** Кнопки с нажатием у последнего сообщения бота в чате. */
    const buttonsOf = (name: string, chatId: number): OldButton[] => {
      const message = sentTo(chatId).at(-1)!;
      const messageId = lastMessageId(chatId);
      return (message.options.keyboard ?? [])
        .flat()
        .filter((b): b is typeof b & { data: string } => typeof b.data === 'string')
        .map((b) => ({ name: `${name}: ${b.text}`, chatId, messageId, data: b.data }));
    };

    /** Что меняют кнопки и ссылки клиента: по этому снимку видно, что закрытый доступ ничего не тронул. */
    const snapshot = async () => ({
      claims: await f.t.admin.db
        .select({
          source: schema.contractorPayClaims.source,
          purpose: schema.contractorPayClaims.purpose,
          status: schema.contractorPayClaims.status,
        })
        .from(schema.contractorPayClaims)
        .orderBy(asc(schema.contractorPayClaims.createdAt)),
      messages: await f.t.admin.db
        .select({
          id: schema.contractorTelegramMessages.id,
          kind: schema.contractorTelegramMessages.kind,
          payload: schema.contractorTelegramMessages.payload,
        })
        .from(schema.contractorTelegramMessages)
        .orderBy(asc(schema.contractorTelegramMessages.id)),
      sentFiles: await f.t.admin.db
        .select({
          name: schema.contractorSentFiles.name,
          state: schema.contractorSentFiles.state,
          contractorId: schema.contractorSentFiles.contractorId,
        })
        .from(schema.contractorSentFiles)
        .orderBy(asc(schema.contractorSentFiles.name)),
      noDebt: await f.t.admin.db
        .select({ noDebt: schema.contractorTelegramLinks.noDebt })
        .from(schema.contractorTelegramLinks)
        .orderBy(asc(schema.contractorTelegramLinks.id)),
      history: await f.t.admin.db
        .select({ action: schema.auditLog.action })
        .from(schema.auditLog)
        .where(
          and(eq(schema.auditLog.orgId, f.a.orgId), eq(schema.auditLog.entity, 'contractor_page')),
        )
        .orderBy(asc(schema.auditLog.at), asc(schema.auditLog.id)),
    });
    /** Пределы частоты не мешают следующему шагу: «Забыли код?» и «/code» — 3 раза в сутки на страницу. */
    const resetLimits = () =>
      f.t.admin.db.execute(sql`delete from rate_limits where kind like 'cp\\_%'`);

    /** Подписка организации А: «Оплачено до» (null — подписки нет), без чеков. */
    const setSubscription = async (paidUntil: string | null) => {
      await f.t.admin.db
        .delete(schema.subscriptionPayments)
        .where(eq(schema.subscriptionPayments.orgId, f.a.orgId));
      if (paidUntil === null) {
        await f.t.admin.db
          .delete(schema.orgSubscriptions)
          .where(eq(schema.orgSubscriptions.orgId, f.a.orgId));
        return;
      }
      await f.t.admin.db
        .insert(schema.orgSubscriptions)
        .values({ orgId: f.a.orgId, planId: 'm1', seats: TEST_SUBSCRIPTION.seats, paidUntil })
        .onConflictDoUpdate({
          target: schema.orgSubscriptions.orgId,
          set: { paidUntil, seats: TEST_SUBSCRIPTION.seats, planId: 'm1' },
        });
    };
    /** Владелец прикрепляет чек на экране «Подписка» (продление на месяц): начать, загрузить, отправить. */
    const ownerReceipt = async () => {
      const pay = { kind: 'renew', planId: 'm1', seats: 10, extraGb: 0, startMode: 'now' };
      const file = { name: 'Чек подписки.pdf', size: PDF.length };
      let res = await call(owner, 'POST', '/api/org/subscription/payments/start', { pay, file });
      expect(res.status, await res.clone().text()).toBe(201);
      const ticket = SubscriptionUploadTicket.parse(await res.json());
      const url = new URL(ticket.upload.url);
      await storage.put(`${url.host}${url.pathname}`, PDF, {
        contentType: ticket.upload.headers['content-type']!,
      });
      res = await call(owner, 'POST', '/api/org/subscription/payments/complete', {
        id: ticket.id,
        pay,
        file,
      });
      expect(res.status, await res.clone().text()).toBe(201);
      return SubscriptionPayDone.parse(await res.json());
    };
    const adminDecide = async (id: string, decision: 'confirm' | 'reject') => {
      const [row] = await f.t.admin.db
        .select({ version: schema.subscriptionPayments.version })
        .from(schema.subscriptionPayments)
        .where(eq(schema.subscriptionPayments.id, id));
      const version = row!.version;
      const body =
        decision === 'confirm'
          ? { months: 1, paidUntil: '2026-11-17', version }
          : { reason: 'Сумма в чеке не совпадает', version };
      const res = await call(
        admin,
        'POST',
        `/api/admin/subscriptions/payments/${id}/${decision}`,
        body,
      );
      expect(res.status, await res.clone().text()).toBe(200);
    };

    /**
     * Сообщения, ушедшие клиентам до закрытия: «К оплате» за сентябрь, «Оплата за обслуживание»,
     * напоминание о долге, вопрос «От какой компании?» и «Я оплатил», начатый на странице.
     */
    async function oldMessages() {
      const send = await call(owner, 'POST', `/api/contractors/${cpA}/month-pay/send`, {
        month: SEP,
      });
      expect(send.status, await send.clone().text()).toBe(200);
      const pay = buttonsOf('«К оплате»', CLIENT_1);
      const fee = await call(owner, 'POST', `/api/contractors/${cpA}/fee-telegram`, {
        text: 'Долг за обслуживание. Пожалуйста, оплатите до 20.10.2026.',
      });
      expect(fee.status, await fee.clone().text()).toBe(200);
      const feeButtons = [
        ...buttonsOf('«Оплата за обслуживание»', CLIENT_1),
        ...buttonsOf('«Оплата за обслуживание»', CLIENT_2),
      ];
      await contractorDebtJob.run({ ...f.deps, clock: fixedClock(MONDAY) }, new Date(MONDAY));
      const debt = buttonsOf('«Напоминание об оплате»', CLIENT_1);
      // Файл без просьбы из чата двух контрагентов организации А — вопрос «От какой компании?».
      await sendFile(CLIENT_2, 'Акт.pdf');
      expect(sentTo(CLIENT_2).at(-1)!.text).toBe(tpl('tgCpFileWhich'));
      const which = lastMessageId(CLIENT_2);
      const rows = await f.t.admin.db
        .select({
          id: schema.contractorTelegramMessages.id,
          contractorId: schema.contractorTelegramMessages.contractorId,
        })
        .from(schema.contractorTelegramMessages)
        .where(
          and(
            eq(schema.contractorTelegramMessages.chatId, CLIENT_2),
            eq(schema.contractorTelegramMessages.kind, 'file'),
          ),
        );
      const fileTo: OldButton = {
        name: '«От какой компании?»: «Ала-Тоо Трейд»',
        chatId: CLIENT_2,
        messageId: which,
        data: botPressData(CP_TG_FILE_TO_ACTION, rows.find((r) => r.contractorId === cpA)!.id),
      };
      // «Прислать чек» в том же чате — просьба «Пришлите чек» с «Отменой» (после вопроса о файле: иначе
      // файл стал бы чеком).
      const receipt = feeButtons.find(
        (b) => b.chatId === CLIENT_2 && b.data.startsWith('cpReceipt'),
      )!;
      await press(receipt.data, CLIENT_2, receipt.messageId);
      expect(sentTo(CLIENT_2).at(-1)!.text).toBe(tpl('tgCpReceiptAsk'));
      const cancel = buttonsOf('«Пришлите чек»', CLIENT_2);
      const buttons = [...pay, ...feeButtons, ...debt, fileTo, ...cancel];
      // Все кнопки, которые проверяет задача, — на месте (имена — из шаблонов сообщений).
      expect(buttons.map((b) => b.name)).toEqual([
        `«К оплате»: ${tpl('tgBtnCpPaid')}`,
        `«К оплате»: ${tpl('tgBtnCpQ')}`,
        `«Оплата за обслуживание»: ${tpl('tgBtnCpPaid')}`,
        `«Оплата за обслуживание»: ${tpl('tgBtnCpReceipt')}`,
        `«Оплата за обслуживание»: ${tpl('tgBtnCpPaid')}`,
        `«Оплата за обслуживание»: ${tpl('tgBtnCpReceipt')}`,
        `«Напоминание об оплате»: ${tpl('tgBtnCpShowReq')}`,
        `«Напоминание об оплате»: ${tpl('tgBtnCpNoDebt')}`,
        fileTo.name,
        `«Пришлите чек»: ${tpl('tgBtnCancel')}`,
      ]);
      const paid = await paidBegin();
      // Ввод кода браузеру без кода при открытом доступе: при закрытом ответ должен быть тем же.
      const gate = await pageRaw();
      expect(gate).toMatchObject({ state: 'code' });
      return { buttons, paid, gate };
    }

    /**
     * Доступ закрыт: каждая старая кнопка — «Доступ организации закрыт» (всплывающим окном), «/code» —
     * «доступ закрыт» вместо кода, а другая организация того же чата отвечает как обычно; страница с
     * запомненным кодом — «Страница временно недоступна», без кода — ввод кода; «Забыли код?» — как без
     * Telegram; «Я оплатил» не начинается и не заканчивается. Данные — как были.
     */
    async function expectClosed(old: Awaited<ReturnType<typeof oldMessages>>) {
      await resetLimits();
      const before = await snapshot();
      const sent = tg.sent.length;
      for (const b of old.buttons) {
        expect(await press(b.data, b.chatId, b.messageId), b.name).toMatchObject({
          text: CLOSED,
          alert: true,
        });
      }
      expect(tg.sent.slice(sent)).toEqual([]);
      await toBot('/code', CLIENT_1);
      const answers = tg.sent.slice(sent);
      expect(answers.map((m) => m.chatId)).toEqual([CLIENT_1, CLIENT_1]);
      // Ровно два ответа: по странице А — «доступ закрыт» без кода ни в тексте, ни в кнопках; по странице
      // Б — её код. Кода страницы А нет нигде: второе сообщение — о странице Б.
      const closedAnswer = answers.find((m) => m.text === closedCode(CP_A));
      expect(closedAnswer).toBeDefined();
      expect(JSON.stringify(closedAnswer!.options)).not.toContain(codeA);
      const codeAnswer = answers.find((m) => m !== closedAnswer)!;
      expect(codeAnswer.text).toContain(pageCodeText(codeB));
      expect(codeAnswer.text).not.toContain(CP_A);
      expect(await pageRaw(grantA)).toEqual({ state: 'org_closed' });
      // Без запомненного кода — тот же ответ, что при открытом доступе: по ссылке не видно, что подписка
      // не оплачена.
      expect(await pageRaw()).toEqual(old.gate);
      expect(await forgot()).toEqual({ outcome: 'none', limit: PAGE_CODE_TG_MAX });
      for (const res of [
        await pagePost(`/api/page/org-a/${INN_A}/paid`, grantA, {
          ...PAID_TAX,
          file: { name: 'Чек 2.pdf', size: PDF.length },
        }),
        await paidComplete(old.paid),
      ]) {
        expect(res.status, await res.clone().text()).toBe(404);
        expect((await failure(res)).code).toBe('page_unavailable');
      }
      expect(tg.sent.slice(sent).map((m) => m.chatId)).toEqual([CLIENT_1, CLIENT_1]);
      expect(await snapshot()).toEqual(before);
    }

    /** Доступ открыт: «Показать реквизиты» присылает реквизиты, страница открыта, код уходит. */
    async function expectOpen(old: Awaited<ReturnType<typeof oldMessages>>) {
      await resetLimits();
      const req = old.buttons.find((b) => b.data.startsWith('cpReq'))!;
      const sent = sentTo(CLIENT_1).length;
      expect((await press(req.data, req.chatId, req.messageId))?.text).not.toBe(CLOSED);
      // Реквизиты для налогов (ответственного) и для обслуживания (организации).
      const requisites = sentTo(CLIENT_1)
        .slice(sent)
        .map((m) => m.text)
        .join('\n');
      expect(requisites).toContain(TAX_REQUISITE_PART);
      expect(requisites).toContain(FEE_REQUISITE_PART);
      const page = await pageState(grantA);
      expect(page.state === 'open' && page.page.contractor.name).toBe(CP_A);
      const before = sentTo(CLIENT_1).length;
      await toBot('/code', CLIENT_1);
      const code = sentTo(CLIENT_1)
        .slice(before)
        .map((m) => m.text);
      expect(code).toHaveLength(2);
      expect(code.some((t) => t.includes(pageCodeText(codeA)))).toBe(true);
      expect(code.some((t) => t.includes(pageCodeText(codeB)))).toBe(true);
      expect(await forgot()).toEqual({ outcome: 'sent', limit: PAGE_CODE_TG_MAX });
    }

    beforeAll(async () => {
      f = await createStaffFixture();
      tg = f.deps.telegram as FakeTelegram;
      storage = f.deps.storage as MemoryStorage;
      await seedAllPlatformDictionaries(f.t.admin.db);
      await features(f.a.orgId);
      await features(f.b.orgId);
      const acc = await signIn(f.app, 'acc-a', TEST_PASSWORD);
      [owner, ownerB, admin] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'owner-b', TEST_PASSWORD),
        signIn(f.app, 'platform-admin', TEST_PASSWORD),
      ]);
      const connect = await call(owner, 'POST', '/api/org-report-types/connect', {
        connect: ['nds', 'pat'],
        disconnect: [],
      });
      expect(connect.status, await connect.clone().text()).toBe(200);
      cpA = await contractor(f.a.orgId, CP_A, INN_A, employee('acc-a'), 300_000);
      cpA2 = await contractor(f.a.orgId, 'ОсОО «Ош Строй»', INN_A2, employee('acc-a'), null);
      cpB = await contractor(f.b.orgId, 'ОсОО «Бишкек»', INN_B, employee('acc-b'), null);
      // Реквизит ответственного — для налогов, счёт организации — для обслуживания.
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
      await report({
        ...mine,
        reportTypeCode: 'nds',
        act: 'both',
        dueBase: '2026-10-20',
        dueDate: '2026-10-20',
        payDue: '2026-10-25',
        amount: 500_000,
        paid: 120_000,
      });
      await report({
        ...mine,
        reportTypeCode: 'pat',
        act: 'pay',
        dueBase: '2026-10-20',
        dueDate: '2026-10-20',
        payDue: '2026-10-20',
        amount: 87_050,
      });
      const a = await linkClient(owner, cpA, INN_A, 'org-a', CLIENT_1);
      grantA = a.cookie;
      codeA = a.code;
      await linkClient(owner, cpA, INN_A, 'org-a', CLIENT_2);
      await linkClient(owner, cpA2, INN_A2, 'org-a', CLIENT_2);
      codeB = (await linkClient(ownerB, cpB, INN_B, 'org-b', CLIENT_1)).code;
    });

    beforeEach(async () => {
      await f.t.admin.db.delete(schema.contractorPayClaims);
      await f.t.admin.db.delete(schema.contractorSentFiles);
      await f.t.admin.db.delete(schema.contractorTelegramMessages);
      await f.t.admin.db.update(schema.contractorTelegramLinks).set({ noDebt: false });
      await f.t.admin.db.delete(schema.telegramOutbox);
      await resetLimits();
      await setSubscription('2026-12-31');
      tg.sent.length = 0;
      tg.messageIds.length = 0;
      tg.answers.length = 0;
      tg.edits.length = 0;
      tg.files.clear();
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('срок прошёл → чек владельца открывает сразу → отклонён — снова закрыто → новый чек не открывает → подтверждён — каждая старая кнопка и ссылка работает', async () => {
      const old = await oldMessages();
      try {
        // «Оплачено до» — 17.10, сегодня 18.10: доступ закрыт со следующего дня.
        await setSubscription('2026-10-17');
        await expectClosed(old);

        // Владелец закрытой организации прикрепляет чек: доступ открыт сразу, до проверки.
        const first = await ownerReceipt();
        expect(first.opensAccess).toBe(true);
        await expectOpen(old);

        // Администратор отклоняет чек: «Оплачено до» прошло — доступ снова закрыт.
        await adminDecide(first.id, 'reject');
        await expectClosed(old);

        // Новый чек после отклонения доступ до подтверждения не открывает.
        const second = await ownerReceipt();
        expect(second.opensAccess).toBe(false);
        await expectClosed(old);

        // Администратор подтверждает: «Оплачено до» — 17.11, все кнопки и ссылки, ушедшие до закрытия,
        // работают как обычно.
        await adminDecide(second.id, 'confirm');
        await expectOpen(old);
        await resetLimits();
        const done = await paidComplete(old.paid);
        expect(done.status, await done.clone().text()).toBe(200);
        const by = (name: string) => old.buttons.filter((b) => b.name.startsWith(name));
        const [payPaid, payAsk] = by('«К оплате»');
        const [feePaid1, , , feeReceipt2] = by('«Оплата за обслуживание»');
        const [, noDebt] = by('«Напоминание об оплате»');
        const [fileTo] = by('«От какой компании?»');
        const [cancel] = by('«Пришлите чек»');
        expect((await press(payPaid!.data, CLIENT_1, payPaid!.messageId))?.text).toBe(
          tpl('tgCpPaidOk'),
        );
        expect((await press(feePaid1!.data, CLIENT_1, feePaid1!.messageId))?.text).toBe(
          tpl('tgCpPaidOk'),
        );
        await press(payAsk!.data, CLIENT_1, payAsk!.messageId);
        expect(sentTo(CLIENT_1).at(-1)!.text).toBe(tpl('tgCpAskHow'));
        expect((await press(noDebt!.data, CLIENT_1, noDebt!.messageId))?.text).toBe(
          tpl('tgCpNoDebtOk'),
        );
        // «Отмена» просьбы, присланной до закрытия, закрывает её; «Прислать чек» — новая просьба.
        expect((await press(cancel!.data, CLIENT_2, cancel!.messageId))?.text).toBe(
          tpl('tgActCancelled'),
        );
        await press(feeReceipt2!.data, CLIENT_2, feeReceipt2!.messageId);
        expect(sentTo(CLIENT_2).at(-1)!.text).toBe(tpl('tgCpReceiptAsk'));
        await press(fileTo!.data, CLIENT_2, fileTo!.messageId);
        expect(sentTo(CLIENT_2).at(-1)!.text).toBe(tpl('tgCpFileOk'));
        const after = await snapshot();
        expect(after.claims).toEqual([
          { source: 'page', purpose: 'tax', status: 'wait' },
          { source: 'telegram', purpose: 'tax', status: 'wait' },
          { source: 'telegram', purpose: 'fee', status: 'wait' },
        ]);
        // «Акт.pdf» — у выбранной в «От какой компании?» «Ала-Тоо Трейд», «Чек.pdf» — «Я оплатил» её страницы.
        expect(after.sentFiles).toEqual([
          { name: 'Акт.pdf', state: 'ready', contractorId: cpA },
          { name: 'Чек.pdf', state: 'ready', contractorId: cpA },
        ]);
        const [link] = await f.t.admin.db
          .select({ noDebt: schema.contractorTelegramLinks.noDebt })
          .from(schema.contractorTelegramLinks)
          .where(
            and(
              eq(schema.contractorTelegramLinks.chatId, CLIENT_1),
              eq(schema.contractorTelegramLinks.contractorId, cpA),
            ),
          );
        expect(link!.noDebt).toBe(true);
      } finally {
        await setSubscription(TEST_SUBSCRIPTION.paidUntil);
      }
    });

    it('«Нет подписки» закрывает старые кнопки и ссылки так же, как прошедший срок; первый чек владельца открывает доступ сразу', async () => {
      const old = await oldMessages();
      try {
        await setSubscription(null);
        await expectClosed(old);
        // Организация ещё ни разу не платила: первый чек открывает доступ до проверки (блок 4, пункты 5–6).
        const first = await ownerReceipt();
        expect(first.opensAccess).toBe(true);
        await expectOpen(old);
      } finally {
        await setSubscription(TEST_SUBSCRIPTION.paidUntil);
      }
    });

    it('исключения п. К-24: «Напоминать» и «Отключить» клиент может и при закрытом доступе; «Код от страницы» без показанного раздела «Telegram» — как при открытом доступе', async () => {
      // Свой чат теста: только «Ош Строй» (организация А), его «Отключить» другим тестам не мешает.
      const CLIENT_3 = 9503;
      await linkClient(owner, cpA2, INN_A2, 'org-a', CLIENT_3);
      const linkOf = async (chatId: number, contractorId: string) =>
        (
          await f.t.admin.db
            .select({
              status: schema.contractorTelegramLinks.status,
              noDebt: schema.contractorTelegramLinks.noDebt,
            })
            .from(schema.contractorTelegramLinks)
            .where(
              and(
                eq(schema.contractorTelegramLinks.chatId, chatId),
                eq(schema.contractorTelegramLinks.contractorId, contractorId),
              ),
            )
        )[0]!;
      const hideTelegram = (hidden: string[]) =>
        f.t.admin.db
          .update(schema.contractorPages)
          .set({ hiddenSections: hidden })
          .where(eq(schema.contractorPages.contractorId, cpA));
      await f.t.admin.db
        .update(schema.contractorTelegramLinks)
        .set({ noDebt: true })
        .where(
          and(
            eq(schema.contractorTelegramLinks.chatId, CLIENT_1),
            eq(schema.contractorTelegramLinks.contractorId, cpA),
          ),
        );
      try {
        await setSubscription('2026-10-17');
        // «Напоминать» — согласие клиента на сообщения: включается и при закрытом доступе.
        await toBot('Напоминать', CLIENT_1);
        expect(sentTo(CLIENT_1).at(-1)!.text).toBe(
          formatText(UI_TEXTS['cppage.tg.debt_on'].ru, { contractor: CP_A }),
        );
        expect((await linkOf(CLIENT_1, cpA)).noDebt).toBe(false);
        // «Отключить» — тоже: чат больше не подключён.
        await toBot('Отключить', CLIENT_3);
        expect(sentTo(CLIENT_3).at(-1)!.text).toBe(
          tpl('tgCpOff', { контрагент: 'ОсОО «Ош Строй»' }),
        );
        expect((await linkOf(CLIENT_3, cpA2)).status).toBe('off');
        // Раздел «Telegram» страницы А скрыт: на «/code» — только код открытой организации Б, без
        // «доступ закрыт» по А — так же, как ответил бы бот при открытом доступе.
        await hideTelegram(['tg']);
        await resetLimits();
        const before = tg.sent.length;
        await toBot('/code', CLIENT_1);
        const answers = tg.sent.slice(before);
        expect(answers.map((m) => m.chatId)).toEqual([CLIENT_1]);
        expect(answers[0]!.text).toContain(pageCodeText(codeB));
        expect(JSON.stringify(answers)).not.toContain(closedCode(CP_A));
        await setSubscription('2026-12-31');
        await resetLimits();
        const open = tg.sent.length;
        await toBot('/code', CLIENT_1);
        expect(tg.sent.slice(open).map((m) => m.text)).toEqual([answers[0]!.text]);
      } finally {
        await hideTelegram([]);
        await setSubscription(TEST_SUBSCRIPTION.paidUntil);
      }
    });
  },
);
