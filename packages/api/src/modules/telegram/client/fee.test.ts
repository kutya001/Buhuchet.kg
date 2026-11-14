import type { FakeTelegram, FixedClock } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  botPressData,
  CP_TG_FEE_MESSAGES,
  CP_TG_PAID_ACTION,
  fillTemplate,
  formatSomWithUnit,
  formatText,
  TELEGRAM_TEMPLATE_DEFAULTS,
} from '@buhuchet/domain';
import {
  ApiError,
  ContractorFeeTelegram,
  ContractorFeeTelegramSent,
  ContractorHistory,
  ContractorPage,
  ContractorTelegram,
  PublicPageTelegramLink,
} from '@buhuchet/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
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

/*
 * «Напомнить в Telegram» об оплате за обслуживание (доработки 14.11.2026, блок 4, пункт 5; прототип v110
 * modules/cp-telegram.js: pgFeeTgShow, pgFeeTgWhy, pgFeeDue, pgFeeTgDlg, pgFeeSend, tgAct('cp-feepaid')).
 * Сегодня в тестах — 18.10.2026 (`createTestDeps`).
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const som = formatSomWithUnit;
/** M-Bank — код refDB.json. */
const MBANK = 'БНК-13';
const CP_A = 'ОсОО «Ала-Тоо Трейд»';
const TODAY = '2026-10-18';
/**
 * 3 000 сом в месяц с июля, день оплаты — 20-е: сроки июля, августа и сентября прошли, октября (20.10) —
 * ещё нет. Долг — три месяца, срок — день оплаты месяца после последнего из них.
 */
const MONTHLY = 300_000;
const DEBT = 3 * MONTHLY;
const STAFF_TEXT = `Долг за обслуживание — ${som(DEBT)} (июль 2026, август 2026, сентябрь 2026). Пожалуйста, оплатите до 20.10.2026.`;
/** Основной счёт организации для обслуживания — номер телефона: копируется только цифрами. */
const FEE_REQUISITE = [
  'Реквизиты для перевода — организации Организация А',
  'Перевод по номеру телефона: 0555 987 654',
  'Банки и кошельки: M-Bank',
  'Получатель: Организация А',
].join('\n');
const COPY_PHONE = { text: TELEGRAM_TEMPLATE_DEFAULTS.tgBtnCpCopyPhone, copy: '0555987654' };
const PAID_HEADING = 'Контрагент сообщил об оплате';

const CHAT_ACC = 7101;
const CHAT_OWNER = 7102;
const CLIENT_1 = 9101;
const CLIENT_2 = 9102;
const CLIENT_B = 9103;
const STRANGER = 9199;

describe.skipIf(!databaseAvailable())(
  '«Напомнить в Telegram» об оплате за обслуживание (доработки 14.11.2026, блок 4, пункт 5; прототип v110)',
  () => {
    let f: Fixture;
    let tg: FakeTelegram;
    let owner: string;
    let chief: string;
    let acc: string;
    let hr: string;
    let ownerB: string;
    let cpA = '';
    let cpNoTg = '';
    let cpB = '';

    const employee = (login: string) => f.people[login]!.employeeId;
    const call = (
      cookie: string | undefined,
      method: 'GET' | 'POST',
      path: string,
      body?: unknown,
    ) => apiRequest(f.app, method, path, cookie, body);
    const failure = async (res: Response) => ApiError.parse(await res.json()).error;
    const text = (
      key: keyof typeof TELEGRAM_TEMPLATE_DEFAULTS,
      values: Record<string, string | number> = {},
    ) => fillTemplate(TELEGRAM_TEMPLATE_DEFAULTS[key], values);

    const state = async (cookie: string, cp: string) => {
      const res = await call(cookie, 'GET', `/api/contractors/${cp}/fee-telegram`);
      expect(res.status, await res.clone().text()).toBe(200);
      return ContractorFeeTelegram.parse(await res.json());
    };
    const send = (cookie: string | undefined, cp: string, body: unknown = { text: STAFF_TEXT }) =>
      call(cookie, 'POST', `/api/contractors/${cp}/fee-telegram`, body);
    const sent = async (cookie: string, cp: string, body?: unknown) => {
      const res = await send(cookie, cp, body);
      expect(res.status, await res.clone().text()).toBe(200);
      return ContractorFeeTelegramSent.parse(await res.json());
    };
    /** Отказ: кнопка видна, окно не открывается, отправка — 409 с тем же кодом и текстом. */
    const refused = async (cp: string, code: keyof typeof CP_TG_FEE_MESSAGES, message: string) => {
      const s = await state(owner, cp);
      expect(s).toMatchObject({ shown: true, refusal: code, dialog: null });
      expect(formatText(CP_TG_FEE_MESSAGES[code], s.params ?? undefined)).toBe(message);
      const res = await send(owner, cp);
      expect(res.status).toBe(409);
      expect(await failure(res)).toMatchObject({ code, message });
    };

    const features = (orgId: string, value: Record<string, boolean>) =>
      f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: value })
        .where(eq(schema.orgSettings.orgId, orgId));
    const ALL_ON = { cppage: true, telegram: true, taxpay: true, fee: true };
    const setContractor = (cp: string, values: Partial<typeof schema.contractors.$inferInsert>) =>
      f.t.admin.db.update(schema.contractors).set(values).where(eq(schema.contractors.id, cp));
    const hidePage = (cp: string, sections: string[]) =>
      f.t.admin.db
        .update(schema.contractorPages)
        .set({ hiddenSections: sections })
        .where(eq(schema.contractorPages.contractorId, cp));
    const FEE_ACCOUNT = {
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
    };
    const addFeeAccount = async () => {
      const res = await call(owner, 'POST', '/api/org/accounts', FEE_ACCOUNT);
      expect(res.status, await res.clone().text()).toBe(200);
    };

    /** Контрагент «создан» в июне со ставкой 3 000 сом в месяц с июля и днём оплаты 20-го. */
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
      const started = await sendToBot(
        f.app,
        telegramUpdate(`/start ${token}`, chatId, { username: name }),
      );
      expect(started.status).toBe(200);
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

    const press = async (data: string, chatId: number, messageId: number, fromId?: number) => {
      const res = await sendToBot(f.app, telegramPress(data, chatId, messageId, { fromId }));
      expect(res.status).toBe(200);
      return tg.answers.at(-1);
    };
    const paidData = botPressData(CP_TG_PAID_ACTION, 'fee');

    /** Строки истории контрагента о «Напомнить в Telegram» и «Оплатил» — как они лежат в базе. */
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
      ).filter((h) => ['page_tg_pay', 'page_tg_paid'].includes(h.action));
    const messages = (contractorId: string) =>
      f.t.admin.db
        .select()
        .from(schema.contractorTelegramMessages)
        .where(eq(schema.contractorTelegramMessages.contractorId, contractorId))
        .orderBy(
          asc(schema.contractorTelegramMessages.createdAt),
          asc(schema.contractorTelegramMessages.chatId),
        );
    const wipe = async () => {
      await f.t.admin.db.delete(schema.contractorTelegramMessages);
      await f.t.admin.db.execute(
        sql`delete from audit_log where action in ('page_tg_pay', 'page_tg_paid')`,
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
      // «Кадрам» (область «Свои») дано право «Видеть плату за обслуживание»: контрагенты чужого
      // бухгалтера им не видны.
      await f.t.admin.db
        .insert(schema.rolePermissions)
        .values({ orgId: f.a.orgId, roleId: f.roleIds.hr, permissionId: 'fee' });
      [owner, chief, acc, hr, ownerB] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'chief-a', TEST_PASSWORD),
        signIn(f.app, 'acc-a', TEST_PASSWORD),
        signIn(f.app, 'hr-a', TEST_PASSWORD),
        signIn(f.app, 'owner-b', TEST_PASSWORD),
      ]);
      cpA = await contractor(f.a.orgId, CP_A, '03744097401851', employee('acc-a'));
      cpNoTg = await contractor(f.a.orgId, 'ИП Садыков', '20101199000123', employee('acc-a'));
      cpB = await contractor(f.b.orgId, 'ОсОО «Бишкек»', '03744097401852', employee('acc-b'));
      await addFeeAccount();
      await linkTelegram(f.app, acc, CHAT_ACC, 'acc_a');
      await linkTelegram(f.app, owner, CHAT_OWNER, 'owner_a');
      await linkClient(owner, cpA, '03744097401851', 'org-a', CLIENT_1, 'client_one');
      await linkClient(owner, cpA, '03744097401851', 'org-a', CLIENT_2, 'client_two');
      // Страница контрагента без Telegram: подключённых нет — кнопки нет.
      expect((await call(owner, 'POST', `/api/contractors/${cpNoTg}/page/enable`)).status).toBe(
        200,
      );
      await linkClient(ownerB, cpB, '03744097401852', 'org-b', CLIENT_B, 'client_b');
    });

    beforeEach(async () => {
      await wipe();
      await f.t.admin.db.update(schema.contractorTelegramLinks).set({ noDebt: false });
      await f.t.admin.db.update(schema.contractorPages).set({ hiddenSections: [] });
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('окно: получатели, текст по шаблону с месяцами долга и сроком, реквизиты для обслуживания', async () => {
      for (const cookie of [owner, chief]) {
        expect(await state(cookie, cpA)).toEqual({
          shown: true,
          refusal: null,
          params: null,
          dialog: {
            contractor: CP_A,
            debt: DEBT,
            recipients: ['@client_one', '@client_two'],
            off: 0,
            text: STAFF_TEXT,
            requisite: FEE_REQUISITE,
            copy: COPY_PHONE.text,
            paid: text('tgBtnCpPaid'),
          },
        });
      }
      // Нажал «Не напоминать» — не получит, в окне — сколько таких.
      await f.t.admin.db
        .update(schema.contractorTelegramLinks)
        .set({ noDebt: true })
        .where(eq(schema.contractorTelegramLinks.chatId, CLIENT_2));
      expect((await state(owner, cpA)).dialog).toMatchObject({
        recipients: ['@client_one'],
        off: 1,
      });
      // Метод только читает.
      expect(tg.sent).toEqual([]);
      expect(await messages(cpA)).toEqual([]);
      expect(await history(cpA)).toEqual([]);
    });

    it('день оплаты 18-го: срок октября — сегодня, октябрь входит в долг; срок — не раньше завтрашнего дня', async () => {
      // День оплаты 18-го: срок октября — сегодня, долг за четыре месяца, срок — 18.11.
      await setContractor(cpA, { feeDay: 18 });
      try {
        expect((await state(owner, cpA)).dialog?.text).toBe(
          text('tgCpFeeRemind', {
            сумма: som(4 * MONTHLY),
            месяц: 'июль 2026, август 2026, сентябрь 2026, октябрь 2026',
            срок: '18.11.2026',
          }),
        );
      } finally {
        await setContractor(cpA, { feeDay: 20 });
      }
    });

    it('кнопки нет: функции, долг, подключённый Telegram, разовый контрагент', async () => {
      const hidden = async (cp: string) => {
        expect(await state(owner, cp)).toEqual({
          shown: false,
          refusal: null,
          params: null,
          dialog: null,
        });
        const res = await send(owner, cp);
        expect(res.status).toBe(409);
        expect(await failure(res)).toMatchObject({
          code: 'cp_tg_fee_off',
          message: CP_TG_FEE_MESSAGES.cp_tg_fee_off,
        });
      };
      // Никто не подключил Telegram.
      await hidden(cpNoTg);
      // Без «Напоминаний в Telegram» или «Страницы контрагента по ссылке».
      const offs: Record<string, boolean>[] = [
        { cppage: true, taxpay: true, fee: true },
        { telegram: true, taxpay: true, fee: true },
      ];
      try {
        for (const off of offs) {
          await features(f.a.orgId, off);
          await hidden(cpA);
        }
        // Без «Платы за обслуживание» вкладки нет — и метода тоже.
        await features(f.a.orgId, { cppage: true, telegram: true, taxpay: true });
        for (const res of [
          await call(owner, 'GET', `/api/contractors/${cpA}/fee-telegram`),
          await send(owner, cpA),
        ]) {
          expect(res.status).toBe(403);
          expect((await failure(res)).code).toBe('fee_off');
        }
      } finally {
        await features(f.a.orgId, ALL_ON);
      }
      // Долга нет: ставка начинается с ноября.
      await f.t.admin.db
        .update(schema.contractorTariffs)
        .set({ validFrom: '2026-11-01' })
        .where(eq(schema.contractorTariffs.contractorId, cpA));
      try {
        await hidden(cpA);
      } finally {
        await f.t.admin.db
          .update(schema.contractorTariffs)
          .set({ validFrom: '2026-07-01' })
          .where(eq(schema.contractorTariffs.contractorId, cpA));
      }
      // У разового контрагента платы за обслуживание нет.
      await setContractor(cpA, { kind: 'oneoff' });
      try {
        await hidden(cpA);
      } finally {
        await setContractor(cpA, { kind: 'regular' });
      }
      expect(tg.sent).toEqual([]);
      expect(await messages(cpA)).toEqual([]);
    });

    it('что мешает: архив, реквизиты для обслуживания, раздел «Telegram», «Не напоминать»', async () => {
      await setContractor(cpA, { serviceStatus: 'archived' });
      try {
        await refused(cpA, 'cp_tg_fee_archived', 'Контрагент в архиве');
      } finally {
        await setContractor(cpA, { serviceStatus: 'active' });
      }
      // Реквизиты уходят клиенту, только пока ему показаны «Как оплатить» и «Оплата за обслуживание».
      for (const [section, title] of [
        ['pay', 'Как оплатить'],
        ['fee', 'Оплата за обслуживание'],
      ] as const) {
        await hidePage(cpA, [section]);
        await refused(
          cpA,
          'cp_tg_fee_req_hidden',
          `Не отправлено: у ${CP_A} на странице скрыт раздел «${title}», а без реквизитов для перевода напоминание не уходит. Покажите раздел в блоке «Страница контрагента».`,
        );
      }
      await hidePage(cpA, []);
      // Раздел «Telegram» скрыт: сообщения клиенту не уходят.
      await hidePage(cpA, ['tg']);
      await refused(
        cpA,
        'cp_tg_fee_tg_off',
        'Раздел «Telegram» страницы контрагента выключен или скрыт: сообщения клиенту в Telegram не уходят',
      );
      await hidePage(cpA, []);
      // Все подключённые нажали «Не напоминать».
      await f.t.admin.db.update(schema.contractorTelegramLinks).set({ noDebt: true });
      await refused(
        cpA,
        'cp_tg_fee_all_off',
        'Все подключённые Telegram выключили напоминания кнопкой «Не напоминать»',
      );
      await f.t.admin.db.update(schema.contractorTelegramLinks).set({ noDebt: false });
      // Нет основного счёта организации для обслуживания.
      await f.t.admin.db.delete(schema.orgAccounts).where(eq(schema.orgAccounts.orgId, f.a.orgId));
      try {
        await refused(
          cpA,
          'cp_tg_fee_no_req',
          `Не отправлено «К оплате»: у ${CP_A} нет реквизитов для перевода. Добавьте основной счёт для обслуживания: «Моя организация» → «Реквизиты».`,
        );
      } finally {
        await addFeeAccount();
      }
      expect(tg.sent).toEqual([]);
      expect(await messages(cpA)).toEqual([]);
      expect(await history(cpA)).toEqual([]);
    });

    it('вход, право, область, чужая организация, неверный текст', async () => {
      expect((await call(undefined, 'GET', `/api/contractors/${cpA}/fee-telegram`)).status).toBe(
        401,
      );
      expect((await send(undefined, cpA)).status).toBe(401);
      // Чужая организация и контрагент вне области — «не найден».
      for (const [cookie, cp] of [
        [ownerB, cpA],
        [owner, cpB],
        [hr, cpA],
      ] as const) {
        expect((await call(cookie, 'GET', `/api/contractors/${cp}/fee-telegram`)).status).toBe(404);
        expect((await send(cookie, cp)).status).toBe(404);
      }
      // Бухгалтер: права «Видеть плату за обслуживание» нет.
      expect((await call(acc, 'GET', `/api/contractors/${cpA}/fee-telegram`)).status).toBe(403);
      expect((await send(acc, cpA)).status).toBe(403);
      // С платой, но без «Просматривать контрагентов» (имена подключённых Telegram) — нельзя.
      await f.t.admin.db
        .delete(schema.rolePermissions)
        .where(
          and(
            eq(schema.rolePermissions.roleId, f.roleIds.hr),
            eq(schema.rolePermissions.permissionId, 'cpView'),
          ),
        );
      try {
        expect((await call(hr, 'GET', `/api/contractors/${cpA}/fee-telegram`)).status).toBe(403);
        expect((await send(hr, cpA)).status).toBe(403);
      } finally {
        await f.t.admin.db
          .insert(schema.rolePermissions)
          .values({ orgId: f.a.orgId, roleId: f.roleIds.hr, permissionId: 'cpView' });
      }
      // Пустой, слишком длинный текст, нет текста, неверный номер контрагента.
      for (const body of [{ text: '   ' }, { text: 'я'.repeat(1001) }, {}, { text: 5 }]) {
        expect((await send(owner, cpA, body)).status).toBe(400);
      }
      const empty = await send(owner, cpA, { text: '' });
      expect(await failure(empty)).toMatchObject({ code: 'validation_failed' });
      expect((await send(owner, 'не-номер')).status).toBe(400);
      // Изменяющий запрос без Origin нашего сайта не проходит.
      const foreign = await f.app.request(`/api/contractors/${cpA}/fee-telegram`, {
        method: 'POST',
        headers: {
          cookie: owner,
          origin: 'https://evil.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: STAFF_TEXT }),
      });
      expect(foreign.status).toBe(403);
      // У организации Б своего счёта для обслуживания нет — счёт организации А ей не подставляется.
      expect(await state(ownerB, cpB)).toMatchObject({
        shown: true,
        refusal: 'cp_tg_fee_no_req',
        dialog: null,
      });
      expect(tg.sent).toEqual([]);
      expect(await messages(cpA)).toEqual([]);
      expect(await history(cpA)).toEqual([]);
    });

    it('«Отправить»: сообщение со сроком, текстом сотрудника, реквизитами и «Оплатил» каждому; история; раз в сутки', async () => {
      const own = `  ${STAFF_TEXT} Спасибо!  `;
      const res = await send(chief, cpA, { text: own });
      expect(res.status, await res.clone().text()).toBe(200);
      const raw = await res.text();
      expect(ContractorFeeTelegramSent.parse(JSON.parse(raw))).toEqual({
        recipients: 2,
        delivered: 2,
      });
      // Реквизиты в ответ отправителю не попадают — только в чат клиента.
      expect(raw).not.toContain('0555');

      expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_1, CLIENT_2]);
      for (const m of tg.sent) {
        expect(m.text).toBe(
          [
            'Оплата за обслуживание до 20.10.2026',
            CP_A,
            `${STAFF_TEXT} Спасибо!`,
            '',
            FEE_REQUISITE,
          ].join('\n'),
        );
        expect(m.options?.keyboard).toEqual([
          [COPY_PHONE],
          [{ text: text('tgBtnCpPaid'), data: paidData }],
        ]);
      }
      expect(
        (await messages(cpA)).map((r) => [
          r.chatId,
          r.kind,
          r.day,
          r.total,
          r.auto,
          r.attempts,
          r.messageId !== null,
          r.sentBy,
        ]),
      ).toEqual([
        [CLIENT_1, 'fee', TODAY, DEBT, false, 1, true, f.people['chief-a']!.userId],
        [CLIENT_2, 'fee', TODAY, DEBT, false, 1, true, f.people['chief-a']!.userId],
      ]);
      expect(await history(cpA)).toEqual([
        {
          action: 'page_tg_pay',
          userId: f.people['chief-a']!.userId,
          changes: [{ field: 'tgFee', to: { total: DEBT, recipients: 2 } }],
        },
      ]);

      // Второй раз за день — нельзя: кнопка показывает, во сколько напоминали.
      const after = await state(owner, cpA);
      expect(after).toMatchObject({ shown: true, refusal: 'cp_tg_fee_today', dialog: null });
      expect(after.params?.time).toMatch(/^\d\d:\d\d$/);
      const again = await send(owner, cpA);
      expect(again.status).toBe(409);
      expect(await failure(again)).toMatchObject({
        code: 'cp_tg_fee_today',
        message: `Сегодня уже напоминали в ${after.params!.time}`,
      });
      expect(tg.sent).toHaveLength(2);
      // Раз в сутки — на контрагента: другой организации не мешает (у неё — свой отказ).
      expect((await state(ownerB, cpB)).refusal).toBe('cp_tg_fee_no_req');
    });

    it('раз в сутки по Бишкеку: в 23:59 — ещё сегодня, с полуночи — можно снова; вчерашняя отправка не мешает', async () => {
      const clock = f.deps.clock as FixedClock;
      await sent(owner, cpA);
      try {
        // 18.10 23:59 по Бишкеку (17:59 UTC) — те же сутки.
        clock.set('2026-10-18T17:59:00Z');
        expect((await state(owner, cpA)).refusal).toBe('cp_tg_fee_today');
        // 19.10 00:00 по Бишкеку (18:00 UTC; в UTC ещё 18.10) — новые сутки.
        clock.set('2026-10-18T18:00:00Z');
        expect((await state(owner, cpA)).refusal).toBeNull();
      } finally {
        clock.set('2026-10-18T03:00:00Z');
      }
      // Отправка, записанная «вчерашним» днём, сегодня не мешает.
      await f.t.admin.db
        .update(schema.contractorTelegramMessages)
        .set({ day: '2026-10-17' })
        .where(eq(schema.contractorTelegramMessages.contractorId, cpA));
      expect((await state(owner, cpA)).refusal).toBeNull();
    });

    it('отправка ещё идёт (записана, попыток не было): меньше 5 минут — «сегодня уже напоминали», дольше — можно', async () => {
      await sent(owner, cpA);
      const inFlight = (minutes: number) =>
        f.t.admin.db
          .update(schema.contractorTelegramMessages)
          .set({
            messageId: null,
            attempts: 0,
            createdAt: sql`now() - make_interval(mins => ${minutes})`,
          })
          .where(eq(schema.contractorTelegramMessages.contractorId, cpA));
      await inFlight(4);
      expect((await state(owner, cpA)).refusal).toBe('cp_tg_fee_today');
      await inFlight(6);
      expect((await state(owner, cpA)).refusal).toBeNull();
    });

    it('две вкладки нажали «Отправить» разом — уходит одно напоминание', async () => {
      const [a, b] = await Promise.all([send(owner, cpA), send(chief, cpA)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const lost = a.status === 409 ? a : b;
      expect((await failure(lost)).code).toBe('cp_tg_fee_today');
      expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_1, CLIENT_2]);
      expect(await history(cpA)).toHaveLength(1);
    });

    it('Telegram не принял ни одного — 409, истории нет, можно отправить снова; принял часть — отправлено части', async () => {
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
        code: 'cp_tg_fee_failed',
        message: 'Не удалось отправить сообщение в Telegram. Попробуйте позже',
      });
      expect(await history(cpA)).toEqual([]);
      expect((await messages(cpA)).map((r) => [r.messageId, r.attempts])).toEqual([
        [null, 1],
        [null, 1],
      ]);
      // Не ушедшее «сегодня уже напоминали» не считается.
      expect((await state(owner, cpA)).refusal).toBeNull();

      tg.failNext(blocked);
      expect(await sent(owner, cpA)).toEqual({ recipients: 2, delivered: 1 });
      expect(tg.sent.map((m) => m.chatId)).toEqual([CLIENT_2]);
      expect((await history(cpA)).map((h) => h.changes)).toEqual([
        [{ field: 'tgFee', to: { total: DEBT, recipients: 1 } }],
      ]);
      expect((await state(owner, cpA)).refusal).toBe('cp_tg_fee_today');
    });

    it('«Оплатил»: сумма из записи, сообщение тому, кто видит плату (ответственному без права — владельцу), история, кнопка гаснет; второй раз — «устарела»', async () => {
      await sent(owner, cpA);
      const [m1, m2] = tg.messageIds as [number, number];
      tg.sent.length = 0;
      tg.messageIds.length = 0;

      // Чужой чат, нажал не хозяин чата, подделанные данные — ничего.
      for (const [data, chat, message, from] of [
        [paidData, CLIENT_2, m1, undefined],
        [paidData, CLIENT_B, m1, undefined],
        [paidData, STRANGER, m2, undefined],
        [paidData, CLIENT_1, m1, CLIENT_2],
        [botPressData(CP_TG_PAID_ACTION, '2026-09'), CLIENT_1, m1, undefined],
        [botPressData(CP_TG_PAID_ACTION), CLIENT_1, m1, undefined],
      ] as const) {
        const a = await press(data, chat, message, from);
        expect(a?.text).not.toBe(text('tgCpPaidOk'));
      }
      expect(tg.edits).toEqual([]);
      expect(await history(cpA)).toHaveLength(1);

      // Функцию «Плата за обслуживание» выключили после отправки — кнопка устарела, ничего не пишется.
      await features(f.a.orgId, { cppage: true, telegram: true, taxpay: true });
      try {
        expect(await press(paidData, CLIENT_1, m1)).toMatchObject({
          text: text('tgActStale'),
          alert: true,
        });
      } finally {
        await features(f.a.orgId, ALL_ON);
      }
      expect(tg.edits).toEqual([]);
      expect(tg.sent).toEqual([]);
      expect(await history(cpA)).toHaveLength(1);

      const answer = await press(paidData, CLIENT_1, m1);
      expect(answer).toMatchObject({ text: text('tgCpPaidOk'), alert: false });
      expect(tg.edits).toEqual([
        {
          chatId: CLIENT_1,
          messageId: m1,
          keyboard: [
            [COPY_PHONE],
            [{ text: '✓ Сообщили бухгалтеру', data: 'off', disabled: true }],
          ],
        },
      ]);
      expect((await history(cpA)).slice(1)).toEqual([
        {
          action: 'page_tg_paid',
          userId: null,
          changes: [{ field: 'tgFeePaid', to: { total: DEBT, name: '@client_one' } }],
        },
      ]);
      // Сумма платы — только тому, кто её видит: у ответственного бухгалтера нет права «Видеть плату
      // за обслуживание» — сообщение владельцу; второму клиенту — ничего.
      const staffText = (name: string) =>
        `${PAID_HEADING}\n${text('tgCpFeePaidStaff', {
          контрагент: CP_A,
          телеграм: name,
          сумма: som(DEBT),
        })}`;
      expect(tg.sent.map((m) => [m.chatId, m.text])).toEqual([
        [CHAT_OWNER, staffText('@client_one')],
      ]);

      // Второе нажатие и повтор от Telegram ничего не меняют.
      const repeat = await press(paidData, CLIENT_1, m1);
      expect(repeat).toMatchObject({ text: text('tgActStale'), alert: true });
      expect(await history(cpA)).toHaveLength(2);
      expect(tg.sent).toHaveLength(1);

      // Ответственный с правом «Видеть плату за обслуживание» получает сообщение сам.
      tg.sent.length = 0;
      const accRole = f.templateRole(f.a, 'acc');
      await f.t.admin.db
        .insert(schema.rolePermissions)
        .values({ orgId: f.a.orgId, roleId: accRole, permissionId: 'fee' });
      try {
        expect(await press(paidData, CLIENT_2, m2)).toMatchObject({ text: text('tgCpPaidOk') });
      } finally {
        await f.t.admin.db
          .delete(schema.rolePermissions)
          .where(
            and(
              eq(schema.rolePermissions.roleId, accRole),
              eq(schema.rolePermissions.permissionId, 'fee'),
            ),
          );
      }
      expect(tg.sent.map((m) => [m.chatId, m.text])).toEqual([
        [CHAT_ACC, staffText('@client_two')],
      ]);
    });

    it('история: записи с суммой платы — только тому, кто видит плату за обслуживание', async () => {
      await sent(owner, cpA);
      await press(paidData, CLIENT_1, tg.messageIds[0]!);
      const fields = async (cookie: string) => {
        const res = await call(cookie, 'GET', `/api/contractors/${cpA}/history`);
        expect(res.status, await res.clone().text()).toBe(200);
        return ContractorHistory.parse(await res.json())
          .items.flatMap((h) => h.changes.map((c) => c.field))
          .filter((x) => x === 'tgFee' || x === 'tgFeePaid');
      };
      expect(await fields(owner)).toEqual(expect.arrayContaining(['tgFee', 'tgFeePaid']));
      expect(await fields(chief)).toHaveLength(2);
      // Ответственный бухгалтер контрагента видит, но платы за обслуживание — нет.
      expect(await fields(acc)).toEqual([]);
    });
  },
);
