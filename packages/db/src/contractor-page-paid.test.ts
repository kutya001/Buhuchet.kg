import { createHash, randomUUID } from 'node:crypto';
import { defaultOrgPolicy } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { enableContractorPage, tryContractorPageCode } from './contractor-page';
import { contractorPageTarget, logPageCodeSent, pageCodeTarget } from './contractor-page-code';
import {
  insertPagePayClaim,
  rejectReceiptClaims,
  sentFilePays,
  waitingPayClaims,
} from './contractor-pay-claims';
import { createContractor, type ContractorFields } from './contractors';
import { readHistory } from './history';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  contractorPages,
  contractorPayClaims,
  contractors,
  contractorSentFiles,
  contractorTelegramLinks,
  feePayments,
  moneyOperations,
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

/*
 * Страница контрагента: «Я оплатил», «Ожидает подтверждения» и код в Telegram (доработки 14.11.2026,
 * блок 6, этап 3; прототип v116 modules/cp-paid.js; миграция 0154).
 */

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

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
  paysTo: 'org',
  gkedConfirmation: null,
});

describe.skipIf(!databaseAvailable())('страница контрагента: «Я оплатил» и код в Telegram', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let cpA = '';
  let cpB = '';
  const INN_A = '03807819461931';
  const INN_B = '03807819461932';

  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  /** Страница без входа: контекст организации без пользователя. */
  const asPage = <T>(orgId: string, fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId, userId: null }, fn);
  const features = (orgId: string, patch: Record<string, boolean> = {}) =>
    db.admin.db
      .update(orgSettings)
      .set({ features: { ...defaultOrgPolicy().features, cppage: true, telegram: true, ...patch } })
      .where(eq(orgSettings.orgId, orgId));

  /** Чек «Я оплатил»: отправленный со страницы файл контрагента. */
  const receipt = async (orgId: string, contractorId: string) => {
    const id = randomUUID();
    await db.admin.db.insert(contractorSentFiles).values({
      id,
      orgId,
      contractorId,
      source: 'page',
      comment: 'Чек: налоги, 5 000 сом',
      name: 'чек.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1200,
      storageKey: `org/${orgId}/sent/${id}`,
    });
    return id;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810471',
      slug: 'paid-a',
      owner: owner('paid-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810472',
      slug: 'paid-b',
      owner: owner('paid-owner-b'),
    });
    await features(a.orgId);
    await features(b.orgId);
    cpA = await inA((tx) => createContractor(tx, a.orgId, contractor(INN_A, 'ОсОО «Укс»'), null));
    cpB = await inB((tx) => createContractor(tx, b.orgId, contractor(INN_B, 'ОсОО «Чужой»'), null));
    await inA((tx) => enableContractorPage(tx, cpA, '482915'));
    await inB((tx) => enableContractorPage(tx, cpB, '482915'));
  });

  afterAll(async () => {
    await db?.drop();
  });

  beforeEach(async () => {
    await db.admin.db.delete(contractorPayClaims);
    await db.admin.db.delete(contractorSentFiles);
    await db.admin.db.delete(moneyOperations);
    await db.admin.db.delete(feePayments);
  });

  it('чья страница по ссылке без кода: только включённая, не архив, организация действует, функция включена', async () => {
    expect(await contractorPageTarget(db.app.db, 'paid-a', INN_A)).toEqual({
      orgId: a.orgId,
      contractorId: cpA,
      closed: false,
    });
    // Чужой ИНН у адреса другой организации — ничего.
    expect(await contractorPageTarget(db.app.db, 'paid-a', INN_B)).toBeNull();
    expect(await contractorPageTarget(db.app.db, 'nope', INN_A)).toBeNull();
    try {
      await db.admin.db
        .update(contractorPages)
        .set({ closedAt: sql`now()` })
        .where(eq(contractorPages.contractorId, cpA));
      expect((await contractorPageTarget(db.app.db, 'paid-a', INN_A))?.closed).toBe(true);
      await db.admin.db
        .update(contractorPages)
        .set({ closedAt: null, enabled: false })
        .where(eq(contractorPages.contractorId, cpA));
      expect(await contractorPageTarget(db.app.db, 'paid-a', INN_A)).toBeNull();
      await db.admin.db
        .update(contractorPages)
        .set({ enabled: true })
        .where(eq(contractorPages.contractorId, cpA));
      await features(a.orgId, { cppage: false });
      expect(await contractorPageTarget(db.app.db, 'paid-a', INN_A)).toBeNull();
      await features(a.orgId);
      await db.admin.db
        .update(organizations)
        .set({ status: 'blocked' })
        .where(eq(organizations.id, a.orgId));
      expect(await contractorPageTarget(db.app.db, 'paid-a', INN_A)).toBeNull();
      await db.admin.db
        .update(organizations)
        .set({ status: 'active' })
        .where(eq(organizations.id, a.orgId));
      await db.admin.db
        .update(contractors)
        .set({ serviceStatus: 'archived' })
        .where(eq(contractors.id, cpA));
      expect(await contractorPageTarget(db.app.db, 'paid-a', INN_A)).toBeNull();
    } finally {
      await db.admin.db
        .update(contractors)
        .set({ serviceStatus: 'active' })
        .where(eq(contractors.id, cpA));
      await db.admin.db
        .update(organizations)
        .set({ status: 'active' })
        .where(eq(organizations.id, a.orgId));
      await db.admin.db
        .update(contractorPages)
        .set({ closedAt: null, enabled: true })
        .where(eq(contractorPages.contractorId, cpA));
      await features(a.orgId);
    }
  });

  it('верный код браузер помнит 1 день (было 30)', async () => {
    const tokenHash = hash(`grant-${randomUUID()}`);
    const opened = await tryContractorPageCode(db.app.db, {
      slug: 'paid-a',
      inn: INN_A,
      code: '482915',
      ipHash: hash('ip-day'),
      tokenHash,
    });
    expect(opened.outcome).toBe('ok');
    const [row] = await db.admin.db.execute<{ hours: number }>(
      sql`select extract(epoch from expires_at - created_at) / 3600 as hours from contractor_page_grants where token_hash = ${tokenHash}`,
    );
    expect(Number(row!.hours)).toBe(24);
  });

  it('код в Telegram: страница, подключённые чаты, раздел «Telegram»; в истории — без кода', async () => {
    const link = async (orgId: string, contractorId: string, chatId: number, status: string) => {
      const [row] = await db.admin.db
        .insert(contractorTelegramLinks)
        .values({ orgId, contractorId, chatId, name: `@chat${chatId}`, status } as never)
        .returning({ id: contractorTelegramLinks.id });
      return row!.id;
    };
    try {
      await link(a.orgId, cpA, 3001, 'on');
      await link(a.orgId, cpA, 3002, 'wait');
      await link(b.orgId, cpB, 3003, 'on');
      const target = await asPage(a.orgId, (tx) => pageCodeTarget(tx, cpA));
      expect(target).toMatchObject({
        contractor: 'ОсОО «Укс»',
        slug: 'paid-a',
        inn: INN_A,
        code: '482915',
        closed: false,
        chats: [{ chatId: 3001, name: '@chat3001' }],
      });
      // Раздел «Telegram» скрыт у контрагента — код в Telegram не уходит.
      await db.admin.db
        .update(contractorPages)
        .set({ hiddenSections: ['tg'] })
        .where(eq(contractorPages.contractorId, cpA));
      expect((await asPage(a.orgId, (tx) => pageCodeTarget(tx, cpA)))?.tgShown).toBe(false);
      await db.admin.db
        .update(contractorPages)
        .set({ hiddenSections: [] })
        .where(eq(contractorPages.contractorId, cpA));
      // Контрагент чужой организации из этой не виден.
      expect(await asPage(a.orgId, (tx) => pageCodeTarget(tx, cpB))).toBeNull();
      await asPage(a.orgId, (tx) =>
        logPageCodeSent(tx, cpA, { chats: ['@chat3001'], via: 'page' }),
      );
      const history = await inA((tx) => readHistory(tx, 'contractor_page', cpA));
      const sent = history.find((h) => h.action === 'page_code_tg');
      expect(sent?.changes).toEqual([
        { field: 'tgCode', to: { chats: ['@chat3001'], via: 'page' } },
      ]);
      expect(JSON.stringify(sent)).not.toContain('482915');
    } finally {
      await db.admin.db.delete(contractorTelegramLinks);
    }
  });

  it('«Я оплатил» ждёт подтверждения, пока бухгалтер не принял деньги этого вида после него', async () => {
    const file = await receipt(a.orgId, cpA);
    await asPage(a.orgId, (tx) =>
      insertPagePayClaim(tx, {
        contractorId: cpA,
        purpose: 'tax',
        month: '2026-10',
        amount: 500_000,
        comment: 'за НДС',
        sentFileId: file,
      }),
    );
    const feeFile = await receipt(a.orgId, cpA);
    await asPage(a.orgId, (tx) =>
      insertPagePayClaim(tx, {
        contractorId: cpA,
        purpose: 'fee',
        month: '2026-10',
        amount: 300_000,
        comment: null,
        sentFileId: feeFile,
      }),
    );
    const waiting = () => asPage(a.orgId, (tx) => waitingPayClaims(tx, cpA));
    expect((await waiting()).map((x) => [x.purpose, x.month, x.amount])).toEqual([
      ['tax', '2026-10', 500_000],
      ['fee', '2026-10', 300_000],
    ]);
    // Чек «Принять» открывает «Принять деньги» с этой суммой и пометкой «со страницы».
    expect((await inA((tx) => sentFilePays(tx, [file]))).get(file)).toEqual({
      purpose: 'tax',
      month: '2026-10',
      amount: 500_000,
      source: 'page',
    });
    // Поступление на налоги — налоги больше не ждут; обслуживание ждёт своей оплаты.
    await inA((tx) =>
      tx.insert(moneyOperations).values({
        contractorId: cpA,
        kind: 'in',
        amount: 500_000,
        total: 500_000,
        opDate: '2026-11-15',
        holderKind: 'org',
      }),
    );
    expect((await waiting()).map((x) => x.purpose)).toEqual(['fee']);
    await inA((tx) =>
      tx
        .insert(feePayments)
        .values({ contractorId: cpA, amount: 300_000, paidOn: '2026-11-15', toKind: 'org' }),
    );
    expect(await waiting()).toEqual([]);
  });

  it('деньги, принятые до сообщения, и отменённое поступление сообщение не закрывают', async () => {
    await inA((tx) =>
      tx.insert(moneyOperations).values({
        contractorId: cpA,
        kind: 'in',
        amount: 100_000,
        total: 100_000,
        opDate: '2026-11-01',
        holderKind: 'org',
      }),
    );
    const file = await receipt(a.orgId, cpA);
    await asPage(a.orgId, (tx) =>
      insertPagePayClaim(tx, {
        contractorId: cpA,
        purpose: 'tax',
        month: null,
        amount: 100_000,
        comment: null,
        sentFileId: file,
      }),
    );
    await inA((tx) =>
      tx.insert(moneyOperations).values({
        contractorId: cpA,
        kind: 'in',
        amount: 100_000,
        total: 100_000,
        opDate: '2026-11-15',
        holderKind: 'org',
        cancelledAt: sql`now()`,
        cancelledBy: a.ownerUserId,
        cancelReason: 'ошибка',
      }),
    );
    expect(await asPage(a.orgId, (tx) => waitingPayClaims(tx, cpA))).toHaveLength(1);
  });

  it('отклонённый чек отклоняет сообщение об оплате с ним — от имени сотрудника; чужая организация — нет', async () => {
    const file = await receipt(a.orgId, cpA);
    await asPage(a.orgId, (tx) =>
      insertPagePayClaim(tx, {
        contractorId: cpA,
        purpose: 'tax',
        month: '2026-10',
        amount: 500_000,
        comment: null,
        sentFileId: file,
      }),
    );
    expect(await inB((tx) => rejectReceiptClaims(tx, file))).toBe(0);
    expect(await asPage(a.orgId, (tx) => waitingPayClaims(tx, cpA))).toHaveLength(1);
    expect(await inA((tx) => rejectReceiptClaims(tx, file))).toBe(1);
    expect(await asPage(a.orgId, (tx) => waitingPayClaims(tx, cpA))).toEqual([]);
    const [row] = await db.admin.db
      .select({ status: contractorPayClaims.status, decidedBy: contractorPayClaims.decidedBy })
      .from(contractorPayClaims)
      .where(eq(contractorPayClaims.sentFileId, file));
    expect(row).toEqual({ status: 'rejected', decidedBy: a.ownerUserId });
    // Второй раз решать нечего.
    expect(await inA((tx) => rejectReceiptClaims(tx, file))).toBe(0);
  });

  it('чужая организация не видна; сообщение со страницы с чеком записывает только страница', async () => {
    const file = await receipt(a.orgId, cpA);
    await asPage(a.orgId, (tx) =>
      insertPagePayClaim(tx, {
        contractorId: cpA,
        purpose: 'tax',
        month: '2026-10',
        amount: 500_000,
        comment: null,
        sentFileId: file,
      }),
    );
    expect(await inB((tx) => waitingPayClaims(tx, cpA))).toEqual([]);
    expect(await inB((tx) => tx.select().from(contractorPayClaims))).toEqual([]);
    // Чек к сообщению ставит только транзакция без пользователя (миграция 0153): сотрудник — нет.
    const other = await receipt(a.orgId, cpA);
    await expect(
      inA((tx) =>
        insertPagePayClaim(tx, {
          contractorId: cpA,
          purpose: 'tax',
          month: '2026-10',
          amount: 1,
          comment: null,
          sentFileId: other,
        }),
      ),
    ).rejects.toThrow();
    // Сообщение не удалить ролью приложения.
    await expect(
      inA((tx) => tx.delete(contractorPayClaims).where(eq(contractorPayClaims.sentFileId, file))),
    ).rejects.toThrow(permissionDenied);
  });
});
