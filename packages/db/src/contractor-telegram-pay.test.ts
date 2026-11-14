import { createHash } from 'node:crypto';
import { defaultOrgPolicy, type BotMessage } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { enableContractorPage, tryContractorPageCode } from './contractor-page';
import {
  decideContractorTelegram,
  issueContractorTelegramLink,
  peekContractorTelegramLink,
  startContractorTelegram,
} from './contractor-telegram';
import {
  answerContractorTelegramAsk,
  autoPayLinkIds,
  contractorsWithTelegram,
  contractorTelegramAskTarget,
  contractorTelegramPayOn,
  contractorTelegramPressTarget,
  contractorTelegramRecipients,
  insertContractorTelegramMessage,
  lockContractorTelegramMessage,
  markContractorTelegramMessage,
  recentManualPaySends,
  refreshContractorTelegramMessage,
  saveContractorTelegramMessage,
  unsentAutoPayMessages,
} from './contractor-telegram-pay';
import { createContractor, type ContractorFields } from './contractors';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  contractorPages,
  contractors,
  contractorTelegramLinks,
  contractorTelegramMessages,
  organizations,
  orgSettings,
} from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const contractor = (inn: string, name: string): ContractorFields => ({
  name,
  inn,
  phone: '+996505890076',
  kind: 'regular',
  formCode: 'ФС-01',
  regimeCode: 'РЕЖ-01',
  regime2Code: null,
  gked: '46.34.0',
  gkedExtra: [],
  taxOfficeCode: null,
  bizSize: 'small',
  benefits: [],
  bases: [],
  responsibleEmployeeId: null,
  head: '',
  contact: '',
  contractNo: '',
  contractDate: null,
  note: '',
  registration: {},
  startDate: '2024-07-16',
  firstMonthMode: 'full',
  feeDay: 10,
  paysTo: 'emp',
  gkedConfirmation: null,
});

const PAY: BotMessage = {
  heading: 'Налоги к оплате до 20.11.2026',
  text: 'Налоги за октябрь 2026',
  buttons: [
    [
      { text: 'Оплатил', action: 'cpPaid', arg: '2026-10' },
      { text: 'Вопрос бухгалтеру', action: 'cpAsk', arg: '2026-10' },
    ],
  ],
};
const ASK: BotMessage = { text: 'Напишите ваш вопрос' };

describe.skipIf(!databaseAvailable())('«К оплате» клиенту в Telegram: данные', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let cpA = '';
  let cpB = '';
  let linkA = '';
  let linkA2 = '';
  let linkB = '';
  const INN_A = '03807819461915';
  const INN_B = '03807819461916';
  const CHAT_A = 1001;
  const CHAT_A2 = 1002;
  const CHAT_B = 2001;

  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  /** Бот без входа: контекст организации сообщения без пользователя. */
  const asBot = <T>(orgId: string, fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId, userId: null }, fn);
  const features = (orgId: string, patch: Record<string, boolean>) =>
    db.admin.db
      .update(orgSettings)
      .set({ features: { ...defaultOrgPolicy().features, cppage: true, telegram: true, ...patch } })
      .where(eq(orgSettings.orgId, orgId));

  let seq = 0;
  /** Клиент открыл страницу, нажал «Подключить Telegram» и «Старт», сотрудник подтвердил. */
  async function connect(
    org: CreatedOrganization,
    slug: string,
    inn: string,
    contractorId: string,
    chatId: number,
  ) {
    const grant = hash(`grant-${slug}-${++seq}`);
    const opened = await tryContractorPageCode(db.app.db, {
      slug,
      inn,
      code: '482915',
      ipHash: hash('ip'),
      tokenHash: grant,
    });
    expect(opened.outcome).toBe('ok');
    const token = hash(`t-${++seq}`);
    expect(
      await issueContractorTelegramLink(db.app.db, {
        slug,
        inn,
        grantHash: grant,
        tokenHash: token,
      }),
    ).toBe('ok');
    const peek = await peekContractorTelegramLink(db.app.db, token, chatId);
    if (peek?.state !== 'ok') throw new Error('ссылка не выдана');
    const res = await asBot(peek.orgId, (tx) =>
      startContractorTelegram(tx, { tokenHash: token, chatId, name: `@chat${chatId}` }),
    );
    if (res.outcome !== 'asked') throw new Error(`запрос не создан: ${res.outcome}`);
    await withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
      decideContractorTelegram(tx, {
        contractorId,
        linkId: res.linkId,
        action: 'approve',
        version: 1,
      }),
    );
    return res.linkId;
  }

  const payInput = (linkId: string, chatId: number, auto = false) => ({
    contractorId: cpA,
    linkId,
    chatId,
    kind: 'pay' as const,
    month: '2026-10' as const,
    total: 625_050,
    auto,
    payload: PAY,
  });
  /** Записать сообщение и отметить отправленным с этим номером. */
  const sentPay = async (linkId: string, chatId: number, messageId: number, auto = false) =>
    inA(async (tx) => {
      const id = (await insertContractorTelegramMessage(tx, payInput(linkId, chatId, auto)))!;
      await markContractorTelegramMessage(tx, id, messageId);
      return id;
    });

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'pay-a',
      owner: owner('pay-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'pay-b',
      owner: owner('pay-owner-b'),
    });
    await features(a.orgId, {});
    await features(b.orgId, {});
    cpA = await inA((tx) => createContractor(tx, a.orgId, contractor(INN_A, 'ОсОО «Укс»'), null));
    cpB = await inB((tx) => createContractor(tx, b.orgId, contractor(INN_B, 'ОсОО «Чужой»'), null));
    await inA((tx) => enableContractorPage(tx, cpA, '482915'));
    await inB((tx) => enableContractorPage(tx, cpB, '482915'));
    linkA = await connect(a, 'pay-a', INN_A, cpA, CHAT_A);
    linkA2 = await connect(a, 'pay-a', INN_A, cpA, CHAT_A2);
    linkB = await connect(b, 'pay-b', INN_B, cpB, CHAT_B);
  });

  afterAll(async () => {
    await db?.drop();
  });

  beforeEach(async () => {
    await db.admin.db.delete(contractorTelegramMessages);
  });

  it('получатели — подключённые Telegram, пока раздел «Telegram» страницы действует', async () => {
    const recipients = () => inA((tx) => contractorTelegramRecipients(tx, cpA));
    const withTelegram = () => inA((tx) => contractorsWithTelegram(tx));
    expect(await recipients()).toEqual([
      { linkId: linkA, chatId: CHAT_A, name: `@chat${CHAT_A}` },
      { linkId: linkA2, chatId: CHAT_A2, name: `@chat${CHAT_A2}` },
    ]);
    expect(await withTelegram()).toEqual([cpA]);

    // Раздел скрыт у контрагента.
    await db.admin.db
      .update(contractorPages)
      .set({ hiddenSections: ['tg'] })
      .where(eq(contractorPages.contractorId, cpA));
    expect(await recipients()).toEqual([]);
    expect(await withTelegram()).toEqual([]);
    await db.admin.db
      .update(contractorPages)
      .set({ hiddenSections: [] })
      .where(eq(contractorPages.contractorId, cpA));

    // Раздел выключен у организации.
    const [before] = await db.admin.db
      .select({ sections: orgSettings.pageSections })
      .from(orgSettings)
      .where(eq(orgSettings.orgId, a.orgId));
    await db.admin.db
      .update(orgSettings)
      .set({ pageSections: before!.sections.filter((s) => s !== 'tg') })
      .where(eq(orgSettings.orgId, a.orgId));
    expect(await recipients()).toEqual([]);
    expect(await withTelegram()).toEqual([]);
    await db.admin.db
      .update(orgSettings)
      .set({ pageSections: before!.sections })
      .where(eq(orgSettings.orgId, a.orgId));

    // Контрагент в архиве.
    await db.admin.db
      .update(contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(contractors.id, cpA));
    expect(await recipients()).toEqual([]);
    expect(await withTelegram()).toEqual([]);
    await db.admin.db
      .update(contractors)
      .set({ serviceStatus: 'active' })
      .where(eq(contractors.id, cpA));

    // Организация заблокирована — её клиентам бот не пишет.
    await db.admin.db
      .update(organizations)
      .set({ status: 'blocked' })
      .where(eq(organizations.id, a.orgId));
    expect(await recipients()).toEqual([]);
    expect(await withTelegram()).toEqual([]);
    await db.admin.db
      .update(organizations)
      .set({ status: 'active' })
      .where(eq(organizations.id, a.orgId));

    // Отключённый чат сообщений не получает.
    await db.admin.db
      .update(contractorTelegramLinks)
      .set({ status: 'off' })
      .where(eq(contractorTelegramLinks.id, linkA2));
    expect((await recipients()).map((r) => r.chatId)).toEqual([CHAT_A]);
    await db.admin.db
      .update(contractorTelegramLinks)
      .set({ status: 'on' })
      .where(eq(contractorTelegramLinks.id, linkA2));
    expect(await recipients()).toHaveLength(2);
  });

  it('«Отправлять «К оплате» контрагентам»: настройка организации и обе функции', async () => {
    expect(await inA((tx) => contractorTelegramPayOn(tx))).toBe(false);
    await db.admin.db
      .update(orgSettings)
      .set({ cpTgPay: true })
      .where(eq(orgSettings.orgId, a.orgId));
    try {
      expect(await inA((tx) => contractorTelegramPayOn(tx))).toBe(true);
      // Настройка организации А организацию Б не включает.
      expect(await inB((tx) => contractorTelegramPayOn(tx))).toBe(false);
      await features(a.orgId, { telegram: false });
      expect(await inA((tx) => contractorTelegramPayOn(tx))).toBe(false);
      await features(a.orgId, { cppage: false });
      expect(await inA((tx) => contractorTelegramPayOn(tx))).toBe(false);
    } finally {
      await features(a.orgId, {});
      await db.admin.db
        .update(orgSettings)
        .set({ cpTgPay: false })
        .where(eq(orgSettings.orgId, a.orgId));
    }
  });

  it('сообщение: запись до отправки, отметка отправки, автор и организация — из контекста', async () => {
    const id = (await inA((tx) => insertContractorTelegramMessage(tx, payInput(linkA, CHAT_A))))!;
    const row = async () =>
      (
        await db.admin.db
          .select()
          .from(contractorTelegramMessages)
          .where(eq(contractorTelegramMessages.id, id))
      )[0]!;
    expect(await row()).toMatchObject({
      orgId: a.orgId,
      contractorId: cpA,
      linkId: linkA,
      chatId: CHAT_A,
      messageId: null,
      kind: 'pay',
      month: '2026-10',
      total: 625_050,
      auto: false,
      attempts: 0,
      answeredAt: null,
      sentBy: a.ownerUserId,
      payload: PAY,
    });
    // Не ушло — только счёт попыток; ушло — номер сообщения.
    await inA((tx) => markContractorTelegramMessage(tx, id, null));
    expect(await row()).toMatchObject({ messageId: null, attempts: 1 });
    await inA((tx) => markContractorTelegramMessage(tx, id, 77));
    expect(await row()).toMatchObject({ messageId: 77, attempts: 2 });
    expect(await inA((tx) => recentManualPaySends(tx, cpA))).toBe(1);
    // Одна отправка в два чата — одна отправка, а не две.
    await inA(async (tx) => {
      await insertContractorTelegramMessage(tx, payInput(linkA, CHAT_A));
      await insertContractorTelegramMessage(tx, payInput(linkA2, CHAT_A2));
    });
    expect(await inA((tx) => recentManualPaySends(tx, cpA))).toBe(2);
  });

  it('само «К оплате» — одна строка на подключение и месяц; не ушедшее повторяется до предела попыток', async () => {
    const first = await inA((tx) =>
      insertContractorTelegramMessage(tx, payInput(linkA, CHAT_A, true)),
    );
    expect(first).toBeTruthy();
    expect(
      await inA((tx) => insertContractorTelegramMessage(tx, payInput(linkA, CHAT_A, true))),
    ).toBeNull();
    // Другой чат, другой месяц и ручная отправка — свои строки.
    expect(
      await inA((tx) => insertContractorTelegramMessage(tx, payInput(linkA2, CHAT_A2, true))),
    ).toBeTruthy();
    expect(
      await inA((tx) =>
        insertContractorTelegramMessage(tx, {
          ...payInput(linkA, CHAT_A, true),
          month: '2026-11',
        }),
      ),
    ).toBeTruthy();
    expect(
      await inA((tx) => insertContractorTelegramMessage(tx, payInput(linkA, CHAT_A))),
    ).toBeTruthy();
    expect(await inA((tx) => autoPayLinkIds(tx, cpA, '2026-10'))).toEqual(new Set([linkA, linkA2]));
    // Ручные отправки само сообщение не считает, и наоборот.
    expect(await inA((tx) => recentManualPaySends(tx, cpA))).toBe(1);

    const unsent = () => inA((tx) => unsentAutoPayMessages(tx, cpA, '2026-10', 3));
    expect((await unsent()).map((m) => m.chatId).sort()).toEqual([CHAT_A, CHAT_A2]);
    await inA((tx) => markContractorTelegramMessage(tx, first!, 501));
    expect((await unsent()).map((m) => m.chatId)).toEqual([CHAT_A2]);
    const [left] = await unsent();
    // Перед повтором не ушедшее собирается заново: итог и сообщение — сегодняшние.
    const next: BotMessage = { ...PAY, text: 'Налоги за октябрь 2026: к оплате 100,00 сом.' };
    expect(
      await inA((tx) =>
        refreshContractorTelegramMessage(tx, left!.id, { total: 10_000, payload: next }),
      ),
    ).toBe(true);
    expect(
      (
        await db.admin.db
          .select({
            total: contractorTelegramMessages.total,
            payload: contractorTelegramMessages.payload,
          })
          .from(contractorTelegramMessages)
          .where(eq(contractorTelegramMessages.id, left!.id))
      )[0],
    ).toEqual({ total: 10_000, payload: next });
    // Ушедшее сообщение не пересобирается: по его итогу клиент жмёт «Оплатил».
    expect(
      await inA((tx) =>
        refreshContractorTelegramMessage(tx, first!, { total: 10_000, payload: next }),
      ),
    ).toBe(false);
    for (let i = 0; i < 3; i++) {
      await inA((tx) => markContractorTelegramMessage(tx, left!.id, null));
    }
    expect(await unsent()).toEqual([]);
  });

  it('нажатие клиента: сообщение находится только по своему чату и номеру', async () => {
    const id = await sentPay(linkA, CHAT_A, 501);
    const idB = await inB(async (tx) => {
      const row = (await insertContractorTelegramMessage(tx, {
        ...payInput(linkB, CHAT_B),
        contractorId: cpB,
      }))!;
      await markContractorTelegramMessage(tx, row, 601);
      return row;
    });
    expect(await contractorTelegramPressTarget(db.app.db, CHAT_A, 501)).toEqual({
      id,
      orgId: a.orgId,
      contractorId: cpA,
      linkId: linkA,
      kind: 'pay',
      linked: true,
    });
    expect(await contractorTelegramPressTarget(db.app.db, CHAT_B, 601)).toMatchObject({
      id: idB,
      orgId: b.orgId,
      contractorId: cpB,
    });
    // Чужой чат, чужой номер, неотправленное сообщение — не находятся.
    expect(await contractorTelegramPressTarget(db.app.db, CHAT_A2, 501)).toBeNull();
    expect(await contractorTelegramPressTarget(db.app.db, CHAT_B, 501)).toBeNull();
    expect(await contractorTelegramPressTarget(db.app.db, CHAT_A, 601)).toBeNull();
    expect(await contractorTelegramPressTarget(db.app.db, CHAT_A, 999)).toBeNull();

    // Подключение больше не действует: отключён, архив, организация заблокирована.
    const linked = async () =>
      (await contractorTelegramPressTarget(db.app.db, CHAT_A, 501))!.linked;
    await db.admin.db
      .update(contractorTelegramLinks)
      .set({ status: 'off' })
      .where(eq(contractorTelegramLinks.id, linkA));
    expect(await linked()).toBe(false);
    expect(
      await asBot(a.orgId, async (tx) => (await lockContractorTelegramMessage(tx, id, CHAT_A))!),
    ).toMatchObject({ linked: false, name: `@chat${CHAT_A}`, month: '2026-10', total: 625_050 });
    await db.admin.db
      .update(contractorTelegramLinks)
      .set({ status: 'on' })
      .where(eq(contractorTelegramLinks.id, linkA));
    await db.admin.db
      .update(contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(contractors.id, cpA));
    expect(await linked()).toBe(false);
    await db.admin.db
      .update(contractors)
      .set({ serviceStatus: 'active' })
      .where(eq(contractors.id, cpA));
    await db.admin.db
      .update(organizations)
      .set({ status: 'blocked' })
      .where(eq(organizations.id, a.orgId));
    expect(await linked()).toBe(false);
    await db.admin.db
      .update(organizations)
      .set({ status: 'active' })
      .where(eq(organizations.id, a.orgId));
    expect(await linked()).toBe(true);
  });

  it('сообщение под блокировкой: только своей организации и своего чата; кнопка гаснет', async () => {
    const id = await sentPay(linkA, CHAT_A, 501);
    const locked = await asBot(a.orgId, (tx) => lockContractorTelegramMessage(tx, id, CHAT_A));
    expect(locked).toEqual({
      message: PAY,
      month: '2026-10',
      total: 625_050,
      answered: false,
      name: `@chat${CHAT_A}`,
      linked: true,
    });
    expect(await asBot(a.orgId, (tx) => lockContractorTelegramMessage(tx, id, CHAT_A2))).toBeNull();
    expect(await asBot(b.orgId, (tx) => lockContractorTelegramMessage(tx, id, CHAT_A))).toBeNull();
    const after: BotMessage = { ...PAY, buttons: [[{ text: '✓ Сообщили бухгалтеру', off: true }]] };
    await asBot(a.orgId, (tx) => saveContractorTelegramMessage(tx, id, after));
    expect(
      (await asBot(a.orgId, (tx) => lockContractorTelegramMessage(tx, id, CHAT_A)))!.message,
    ).toEqual(after);
    // Чужая организация кнопки не погасит.
    await asBot(b.orgId, (tx) => saveContractorTelegramMessage(tx, id, PAY));
    expect(
      (await asBot(a.orgId, (tx) => lockContractorTelegramMessage(tx, id, CHAT_A)))!.message,
    ).toEqual(after);
    // Раздел «Telegram» страницы скрыт у контрагента — подключение не действует, кнопки не работают.
    await db.admin.db
      .update(contractorPages)
      .set({ hiddenSections: ['tg'] })
      .where(eq(contractorPages.contractorId, cpA));
    expect(
      (await asBot(a.orgId, (tx) => lockContractorTelegramMessage(tx, id, CHAT_A)))!.linked,
    ).toBe(false);
    await db.admin.db
      .update(contractorPages)
      .set({ hiddenSections: [] })
      .where(eq(contractorPages.contractorId, cpA));
    expect(
      (await asBot(a.orgId, (tx) => lockContractorTelegramMessage(tx, id, CHAT_A)))!.linked,
    ).toBe(true);
  });

  it('просьба «напишите вопрос»: по ответу на неё или последняя за сутки; отвеченная закрыта', async () => {
    const ask = async (linkId: string, chatId: number, messageId: number | null) =>
      inA(async (tx) => {
        const id = (await insertContractorTelegramMessage(tx, {
          contractorId: cpA,
          linkId,
          chatId,
          kind: 'ask',
          payload: ASK,
        }))!;
        if (messageId !== null) await markContractorTelegramMessage(tx, id, messageId);
        return id;
      });
    expect(await contractorTelegramAskTarget(db.app.db, CHAT_A, null)).toBeNull();
    const first = await ask(linkA, CHAT_A, 701);
    // Не отправленная просьба вопроса не ждёт.
    await ask(linkA2, CHAT_A2, null);
    expect(await contractorTelegramAskTarget(db.app.db, CHAT_A2, null)).toBeNull();

    expect(await contractorTelegramAskTarget(db.app.db, CHAT_A, null)).toEqual({
      id: first,
      orgId: a.orgId,
      contractorId: cpA,
      linkId: linkA,
      kind: 'ask',
      linked: true,
    });
    expect(await contractorTelegramAskTarget(db.app.db, CHAT_A, 701)).toMatchObject({ id: first });
    // Ответ на другое сообщение и чужой чат — не вопрос.
    expect(await contractorTelegramAskTarget(db.app.db, CHAT_A, 702)).toBeNull();
    expect(await contractorTelegramAskTarget(db.app.db, CHAT_A2, 701)).toBeNull();
    expect(await contractorTelegramAskTarget(db.app.db, CHAT_B, 701)).toBeNull();
    // Сообщение «К оплате» — не просьба.
    await sentPay(linkA, CHAT_A, 501);
    expect(await contractorTelegramAskTarget(db.app.db, CHAT_A, 501)).toBeNull();

    // Просьба старше суток без ответа на неё не действует, по ответу на неё — действует.
    await db.admin.db
      .update(contractorTelegramMessages)
      .set({ createdAt: sql`now() - interval '25 hours'` })
      .where(eq(contractorTelegramMessages.id, first));
    expect(await contractorTelegramAskTarget(db.app.db, CHAT_A, null)).toBeNull();
    expect(await contractorTelegramAskTarget(db.app.db, CHAT_A, 701)).toMatchObject({ id: first });

    // Отключённый Telegram вопросов не задаёт: просьба находится, но подключение не действует.
    await db.admin.db
      .update(contractorTelegramLinks)
      .set({ status: 'off' })
      .where(eq(contractorTelegramLinks.id, linkA));
    expect(await contractorTelegramAskTarget(db.app.db, CHAT_A, 701)).toMatchObject({
      id: first,
      linked: false,
    });
    await db.admin.db
      .update(contractorTelegramLinks)
      .set({ status: 'on' })
      .where(eq(contractorTelegramLinks.id, linkA));

    // Ответ принимается один раз, и только своей организацией.
    expect(await asBot(b.orgId, (tx) => answerContractorTelegramAsk(tx, first))).toBe(false);
    expect(await asBot(a.orgId, (tx) => answerContractorTelegramAsk(tx, first))).toBe(true);
    expect(await asBot(a.orgId, (tx) => answerContractorTelegramAsk(tx, first))).toBe(false);
    expect(await contractorTelegramAskTarget(db.app.db, CHAT_A, 701)).toBeNull();
  });

  it('чужая организация не видна: сообщения, получатели, отметки', async () => {
    const id = await sentPay(linkA, CHAT_A, 501);
    expect(await inB((tx) => tx.select().from(contractorTelegramMessages))).toEqual([]);
    expect(await inB((tx) => contractorTelegramRecipients(tx, cpA))).toEqual([]);
    expect(await inB((tx) => contractorsWithTelegram(tx))).toEqual([cpB]);
    expect(await inB((tx) => recentManualPaySends(tx, cpA))).toBe(0);
    expect(await inB((tx) => autoPayLinkIds(tx, cpA, '2026-10'))).toEqual(new Set());
    // Отметка из чужой организации строку не меняет.
    await inB((tx) => markContractorTelegramMessage(tx, id, 999));
    expect(
      (
        await db.admin.db
          .select({ messageId: contractorTelegramMessages.messageId })
          .from(contractorTelegramMessages)
          .where(eq(contractorTelegramMessages.id, id))
      )[0]!.messageId,
    ).toBe(501);
    // Сообщение к чужому подключению или чужому контрагенту не записать.
    await expect(
      inB((tx) => insertContractorTelegramMessage(tx, payInput(linkA, CHAT_A))),
    ).rejects.toThrow();
    await expect(
      inB((tx) =>
        insertContractorTelegramMessage(tx, { ...payInput(linkB, CHAT_B), contractorId: cpA }),
      ),
    ).rejects.toThrow();
    // Чат должен быть чатом этого подключения.
    await expect(
      inA((tx) => insertContractorTelegramMessage(tx, payInput(linkA, CHAT_B))),
    ).rejects.toThrow();
    // Без контекста организации строк не видно.
    expect(await db.app.db.select().from(contractorTelegramMessages)).toEqual([]);
  });

  it('роль приложения: сообщение не удалить, месяц, сумму, чат и получателя не поменять', async () => {
    const id = await sentPay(linkA, CHAT_A, 501);
    const mine = eq(contractorTelegramMessages.id, id);
    await expect(inA((tx) => tx.delete(contractorTelegramMessages).where(mine))).rejects.toEqual(
      permissionDenied,
    );
    // Итог отправленного сообщения не меняется (по нему пишется «Оплатил»).
    await expect(
      inA((tx) => tx.update(contractorTelegramMessages).set({ total: 1 }).where(mine)),
    ).rejects.toThrow();
    // Записать сообщение от чужого имени нельзя: автор — пользователь запроса (у бота автора нет).
    await expect(
      asBot(a.orgId, (tx) =>
        tx.insert(contractorTelegramMessages).values({
          orgId: a.orgId,
          contractorId: cpA,
          linkId: linkA,
          chatId: CHAT_A,
          kind: 'pay',
          month: '2026-10',
          total: 100,
          payload: PAY,
          sentBy: a.ownerUserId,
        }),
      ),
    ).rejects.toThrow();
    for (const patch of [
      { month: '2026-01' },
      { chatId: CHAT_B },
      { linkId: linkA2 },
      { kind: 'ask' as const },
      { auto: true },
      { sentBy: null },
    ]) {
      await expect(
        inA((tx) => tx.update(contractorTelegramMessages).set(patch).where(mine)),
      ).rejects.toEqual(permissionDenied);
    }
    // Функции «чьё сообщение» — только роли приложения, прямого чтения мимо RLS нет.
    await expect(
      db.app.db.execute(sql`select * from contractor_telegram_messages where id = ${id}`),
    ).resolves.toHaveLength(0);
  });

  it('проверки строки: вид, месяц, «К оплате» — с месяцем и суммой', async () => {
    const bad = (patch: Record<string, unknown>) =>
      db.admin.db.insert(contractorTelegramMessages).values({
        orgId: a.orgId,
        contractorId: cpA,
        linkId: linkA,
        chatId: CHAT_A,
        kind: 'pay',
        month: '2026-10',
        total: 100,
        payload: PAY,
        ...patch,
      } as typeof contractorTelegramMessages.$inferInsert);
    await expect(bad({ kind: 'other' })).rejects.toThrow();
    await expect(bad({ month: '2026-13' })).rejects.toThrow();
    await expect(bad({ month: null })).rejects.toThrow();
    await expect(bad({ total: null })).rejects.toThrow();
    await expect(bad({ total: 0 })).rejects.toThrow();
    await bad({});
    // Номер сообщения в чате не повторяется.
    await db.admin.db.update(contractorTelegramMessages).set({ messageId: 42 });
    await expect(bad({ messageId: 42 })).rejects.toThrow();
  });
});
