import { createHash } from 'node:crypto';
import { defaultOrgPolicy } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import {
  changeContractorPageCode,
  cleanupContractorPageGrants,
  contractorPageHeader,
  contractorPageState,
  disableContractorPage,
  enableContractorPage,
  getContractorPage,
  setContractorPageHidden,
  tryContractorPageCode,
  writeContractorPageOpen,
} from './contractor-page';
import { createContractor, type ContractorFields } from './contractors';
import { readHistory } from './history';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  contractorPageGrants,
  contractorPages,
  contractors,
  orgSettings,
  organizations,
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

const contractor = (inn: string, patch: Partial<ContractorFields> = {}): ContractorFields => ({
  name: 'ОсОО «Укс»',
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
  ...patch,
});

describe.skipIf(!databaseAvailable())('Страница контрагента по ссылке: данные', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let cpId = '';
  let cpB = '';
  const INN = '03807819461915';
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  /** Страница без входа: контекст организации без пользователя. */
  const inAnonymous = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: null }, fn);
  const cppage = (orgId: string, on: boolean) =>
    db.admin.db
      .update(orgSettings)
      .set({ features: { ...defaultOrgPolicy().features, cppage: on } })
      .where(eq(orgSettings.orgId, orgId));
  const page = () =>
    db.admin.db.select().from(contractorPages).where(eq(contractorPages.contractorId, cpId));
  const code = async () => (await page())[0]!.code;
  let ipSeq = 0;
  const attempt = (value: string, options: { ip?: string; token?: string; slug?: string } = {}) =>
    tryContractorPageCode(db.app.db, {
      slug: options.slug ?? 'page-a',
      inn: INN,
      code: value,
      ipHash: hash(options.ip ?? `ip-${++ipSeq}`),
      tokenHash: hash(options.token ?? `token-${ipSeq}-${Math.random()}`),
    });
  const wrongOf = (right: string) => (right === '000000' ? '111111' : '000000');

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'page-a',
      owner: owner('page-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'page-b',
      owner: owner('page-owner-b'),
    });
    await cppage(a.orgId, true);
    await cppage(b.orgId, true);
    cpId = await inA((tx) => createContractor(tx, a.orgId, contractor(INN), null));
    // Тот же ИНН у другой организации — другая страница (ТЗ).
    cpB = await inB((tx) => createContractor(tx, b.orgId, contractor(INN), null));
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('включить: код, история; повторно — «уже включена»; выключить и включить снова — новый номер кода', async () => {
    expect(await inA((tx) => getContractorPage(tx, cpId))).toBeNull();
    expect(await inA((tx) => enableContractorPage(tx, cpId, '482915'))).toBe('enabled');
    expect(await inA((tx) => enableContractorPage(tx, cpId, '111111'))).toBe('already');
    const got = await inA((tx) => getContractorPage(tx, cpId));
    expect(got).toMatchObject({
      enabled: true,
      code: '482915',
      hiddenSections: [],
      lastOpenAt: null,
    });
    expect(await inA((tx) => disableContractorPage(tx, cpId))).toBe(true);
    expect(await inA((tx) => disableContractorPage(tx, cpId))).toBe(false);
    expect(await inA((tx) => changeContractorPageCode(tx, cpId, '222222'))).toBe(false);
    expect(await inA((tx) => enableContractorPage(tx, cpId, '333333'))).toBe('enabled');
    expect((await page())[0]).toMatchObject({ enabled: true, code: '333333', codeVersion: 2 });
    const history = await inA((tx) => readHistory(tx, 'contractor_page', cpId));
    expect(history.map((h) => h.action)).toEqual(['page_on', 'page_off', 'page_on']);
    expect(history.every((h) => h.contractorId === cpId && h.actorUserId === a.ownerUserId)).toBe(
      true,
    );
    // Код в историю не пишется.
    expect(JSON.stringify(history)).not.toContain('333333');
  });

  it('сменить код: номер кода +1, счёт неверных кодов снят; разделы — с версией и «было → стало»', async () => {
    await db.admin.db.update(contractorPages).set({ failures: 3 });
    expect(await inA((tx) => changeContractorPageCode(tx, cpId, '444444'))).toBe(true);
    expect((await page())[0]).toMatchObject({ code: '444444', codeVersion: 3, failures: 0 });
    const { version } = (await inA((tx) => getContractorPage(tx, cpId)))!;
    await inA((tx) => setContractorPageHidden(tx, cpId, ['fee'], version));
    await expect(inA((tx) => setContractorPageHidden(tx, cpId, [], version))).rejects.toThrow(
      /изменена/,
    );
    const last = (await inA((tx) => readHistory(tx, 'contractor_page', cpId))).at(-1);
    expect(last).toMatchObject({
      action: 'update',
      changes: [{ field: 'hiddenSections', from: [], to: ['fee'] }],
    });
    expect(
      JSON.stringify(await inA((tx) => readHistory(tx, 'contractor_page', cpId))),
    ).not.toContain('444444');
    // Раздел не из списка страницы база не примет.
    await expect(
      db.admin.db.update(contractorPages).set({ hiddenSections: ['tasks'] }),
    ).rejects.toThrow();
  });

  it('чужая организация: страницы не видны, не меняются и не создаются; запомненные браузеры роль не видит', async () => {
    expect(await inB((tx) => getContractorPage(tx, cpId))).toBeNull();
    expect(await inB((tx) => changeContractorPageCode(tx, cpId, '555555'))).toBe(false);
    expect(await inB((tx) => disableContractorPage(tx, cpId))).toBe(false);
    expect((await page())[0]!.enabled).toBe(true);
    // Страница для контрагента чужой организации: составной ключ и RLS.
    await expect(inB((tx) => enableContractorPage(tx, cpId, '555555'))).rejects.toThrow();
    await expect(inB((tx) => tx.select().from(contractorPageGrants))).rejects.toThrow(
      permissionDenied,
    );
    // Вставка от чужого имени: автор — только сам.
    await expect(
      inB((tx) =>
        tx.insert(contractorPages).values({
          contractorId: cpB,
          orgId: b.orgId,
          code: '123456',
          createdBy: a.ownerUserId,
        }),
      ),
    ).rejects.toThrow();
    // Без контекста не видно ничего.
    expect(await db.app.db.select().from(contractorPages)).toEqual([]);
    // Счёт неверных кодов не удалить и страницу не удалить.
    await expect(
      inA((tx) => tx.delete(contractorPages).where(eq(contractorPages.contractorId, cpId))),
    ).rejects.toThrow(permissionDenied);
    await expect(inA((tx) => tx.update(contractorPages).set({ orgId: b.orgId }))).rejects.toThrow(
      permissionDenied,
    );
  });

  it('без входа: неизвестные адрес и ИНН, выключенная, архивный контрагент, выключенная функция и блокировка — «недоступна»', async () => {
    const state = (slug: string, inn = INN) => contractorPageState(db.app.db, slug, inn, null);
    expect(await state('page-a')).toEqual({ state: 'code' });
    expect(await state('page-x')).toEqual({ state: 'unavailable' });
    expect(await state('page-a', '03807819461916')).toEqual({ state: 'unavailable' });
    // У организации Б страница этого ИНН не включена.
    expect(await state('page-b')).toEqual({ state: 'unavailable' });
    expect(await attempt(await code(), { slug: 'page-b' })).toEqual({ outcome: 'unavailable' });
    await cppage(a.orgId, false);
    expect(await state('page-a')).toEqual({ state: 'unavailable' });
    expect(await attempt(await code())).toEqual({ outcome: 'unavailable' });
    await cppage(a.orgId, true);
    await db.admin.db
      .update(contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(contractors.id, cpId));
    expect(await state('page-a')).toEqual({ state: 'unavailable' });
    await db.admin.db
      .update(contractors)
      .set({ serviceStatus: 'active' })
      .where(eq(contractors.id, cpId));
    await db.admin.db
      .update(organizations)
      .set({ status: 'blocked' })
      .where(eq(organizations.id, a.orgId));
    expect(await state('page-a')).toEqual({ state: 'unavailable' });
    await db.admin.db
      .update(organizations)
      .set({ status: 'active' })
      .where(eq(organizations.id, a.orgId));
    await inA((tx) => disableContractorPage(tx, cpId));
    expect(await state('page-a')).toEqual({ state: 'unavailable' });
    await inA((tx) => enableContractorPage(tx, cpId, '482915'));
    expect(await state('page-a')).toEqual({ state: 'code' });
  });

  it('5 неверных кодов подряд — ввод по ссылке закрыт на 15 минут; верный код запоминает браузер до смены кода', async () => {
    const right = await code();
    const wrong = wrongOf(right);
    for (const left of [4, 3, 2, 1]) {
      expect(await attempt(wrong)).toEqual({ outcome: 'wrong', triesLeft: left });
    }
    expect(await attempt(wrong)).toMatchObject({ outcome: 'locked' });
    // Перерыв — в истории контрагента той же транзакцией, без сотрудника.
    const locks = (await inA((tx) => readHistory(tx, 'contractor_page', cpId))).filter(
      (h) => h.action === 'page_lock',
    );
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({ contractorId: cpId, actorUserId: null });
    // Пока закрыто — и верный код не принимается, счёт не идёт.
    expect(await attempt(right)).toMatchObject({ outcome: 'locked' });
    expect(await contractorPageState(db.app.db, 'page-a', INN, null)).toMatchObject({
      state: 'locked',
    });
    // Через 15 минут — снова ввод; верный код снимает счёт.
    await db.admin.db
      .update(contractorPages)
      .set({ lockedUntil: sql`now() - interval '1 second'` });
    expect(await attempt(wrong)).toEqual({ outcome: 'wrong', triesLeft: 4 });
    expect(await attempt(right, { token: 'browser-1' })).toEqual({ outcome: 'ok' });
    expect((await page())[0]).toMatchObject({ failures: 0, lockedUntil: null });
    expect(await contractorPageState(db.app.db, 'page-a', INN, hash('browser-1'))).toEqual({
      state: 'open',
      orgId: a.orgId,
      contractorId: cpId,
    });
    // Чужой токен и токен другой ссылки не открывают.
    expect(await contractorPageState(db.app.db, 'page-a', INN, hash('browser-2'))).toEqual({
      state: 'code',
    });
    expect(await contractorPageState(db.app.db, 'page-b', INN, hash('browser-1'))).toEqual({
      state: 'unavailable',
    });
    // «Сменить код» закрывает доступ и в запомненном браузере.
    await inA((tx) => changeContractorPageCode(tx, cpId, '654321'));
    expect(await contractorPageState(db.app.db, 'page-a', INN, hash('browser-1'))).toEqual({
      state: 'code',
    });
    expect(await cleanupContractorPageGrants(db.app.db)).toBe(1);
  });

  it('«подряд» — до верного кода: давние неверные коды тоже считаются (прототип p.fails)', async () => {
    const wrong = wrongOf(await code());
    expect(await attempt(wrong)).toEqual({ outcome: 'wrong', triesLeft: 4 });
    expect(await attempt(wrong)).toEqual({ outcome: 'wrong', triesLeft: 3 });
    await db.admin.db.update(contractorPages).set({ updatedAt: sql`now() - interval '30 days'` });
    expect(await attempt(wrong)).toEqual({ outcome: 'wrong', triesLeft: 2 });
    await db.admin.db.update(contractorPages).set({ failures: 0 });
  });

  it('одновременные неверные коды по ссылке считаются по очереди: ровно 5 до перерыва', async () => {
    const wrong = wrongOf(await code());
    const results = await Promise.all(Array.from({ length: 10 }, () => attempt(wrong)));
    const outcomes = results.map((r) => r.outcome);
    expect(outcomes.filter((o) => o === 'wrong')).toHaveLength(4);
    expect(outcomes.filter((o) => o === 'locked')).toHaveLength(6);
    const left = results.flatMap((r) => (r.outcome === 'wrong' ? [r.triesLeft] : []));
    expect(left.sort()).toEqual([1, 2, 3, 4]);
    const locks = (await inA((tx) => readHistory(tx, 'contractor_page', cpId))).filter(
      (h) => h.action === 'page_lock',
    );
    expect(locks).toHaveLength(2);
    await db.admin.db.update(contractorPages).set({ failures: 0, lockedUntil: null });
  });

  it('одновременные неверные коды с одного адреса — точный счёт', async () => {
    const wrong = wrongOf(await code());
    const ip = 'parallel-address';
    // Четыре одновременные попытки (до перерыва по ссылке) — четыре строки счёта адреса.
    await db.admin.db.update(contractorPages).set({ failures: 0, lockedUntil: null });
    const rows = () =>
      db.admin.db.execute(
        sql`select count(*)::int as n from rate_limits where kind = 'cp_page_ip' and subject = ${hash(ip)}`,
      ) as unknown as Promise<{ n: number }[]>;
    const before = (await rows())[0]!.n;
    await Promise.all(Array.from({ length: 4 }, () => attempt(wrong, { ip })));
    expect((await rows())[0]!.n - before).toBe(4);
    await db.admin.db.update(contractorPages).set({ failures: 0, lockedUntil: null });
  });

  it('у страницы не больше 20 запомненных браузеров: старшие забываются', async () => {
    const right = await code();
    await db.admin.db.delete(contractorPageGrants);
    for (let i = 1; i <= 22; i++) {
      expect(await attempt(right, { token: `many-${i}` })).toEqual({ outcome: 'ok' });
    }
    expect(await db.admin.db.select().from(contractorPageGrants)).toHaveLength(20);
    expect(await contractorPageState(db.app.db, 'page-a', INN, hash('many-1'))).toEqual({
      state: 'code',
    });
    expect(await contractorPageState(db.app.db, 'page-a', INN, hash('many-22'))).toMatchObject({
      state: 'open',
    });
  });

  it('30 неверных кодов за час с одного адреса по всем ссылкам — ввод с него закрыт на час', async () => {
    const right = await code();
    const wrong = wrongOf(right);
    const ip = 'one-address';
    let last;
    for (let i = 1; i <= 30; i++) {
      // Ссылка закрылась бы на пятом — снимаем перерыв, чтобы считался только адрес.
      await db.admin.db.update(contractorPages).set({ failures: 0, lockedUntil: null });
      last = await attempt(wrong, { ip });
      if (i < 30) expect(last.outcome).toBe('wrong');
    }
    expect(last).toMatchObject({ outcome: 'ip_locked' });
    // С этого адреса закрыто и для верного кода, с другого — открыто.
    expect(await attempt(right, { ip })).toMatchObject({ outcome: 'ip_locked' });
    expect(await attempt(right, { ip: 'other-address' })).toMatchObject({ outcome: 'ok' });
    // Адрес хранится хешем.
    const rows = (await db.admin.db.execute(
      sql`select count(*)::int as n from rate_limits where subject = ${ip}`,
    )) as unknown as { n: number }[];
    expect(rows[0]?.n).toBe(0);
  });

  it('открытие страницы — в истории контрагента с устройством; повтор за минуту — то же открытие; шапка', async () => {
    const opens = async () =>
      (await inA((tx) => readHistory(tx, 'contractor_page', cpId))).filter(
        (h) => h.action === 'page_open',
      );
    const before = (await opens()).length;
    await inAnonymous((tx) => writeContractorPageOpen(tx, cpId, 'Телефон · Safari'));
    await inAnonymous((tx) => writeContractorPageOpen(tx, cpId, 'Телефон · Safari'));
    await inAnonymous((tx) => writeContractorPageOpen(tx, cpId, 'ПК · Chrome'));
    const after = await opens();
    expect(after.length - before).toBe(2);
    expect(after.at(-1)).toMatchObject({
      actorUserId: null,
      changes: [{ field: 'device', to: 'ПК · Chrome' }],
    });
    const got = await inA((tx) => getContractorPage(tx, cpId));
    expect(got?.lastDevice).toBe('ПК · Chrome');
    expect(got?.lastOpenAt).toBeInstanceOf(Date);
    // «Выключить» и «Включить» снова — «Последнее открытие» начинается заново (прототип pgEnable).
    await inA((tx) => disableContractorPage(tx, cpId));
    await inA((tx) => enableContractorPage(tx, cpId, '135790'));
    expect(await inA((tx) => getContractorPage(tx, cpId))).toMatchObject({
      lastOpenAt: null,
      lastDevice: null,
    });
    expect(await inA((tx) => contractorPageHeader(tx, cpId))).toMatchObject({
      name: 'ОсОО «Укс»',
      inn: INN,
      orgName: 'Организация А',
    });
    expect(await inB((tx) => contractorPageHeader(tx, cpId))).toBeNull();
  });
});
