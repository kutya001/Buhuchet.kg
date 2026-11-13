import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { contractorScope, createContractor, type ContractorFields } from './contractors';
import { createOrganization, type CreatedOrganization } from './organizations';
import { reportScope } from './report-list';
import { contractors, employees, reports, telegramLinkGuards, users } from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { createEmployee } from './staff';
import { createTelegramLinkToken, useTelegramLink } from './telegram';
import {
  botChatUsers,
  commandCardReports,
  commandContractor,
  commandReports,
  findCommandContractors,
} from './telegram-commands';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

// Сегодня — пятница 13.11.2026; конец недели — воскресенье 15.11.
const TODAY = '2026-11-13';
const HORIZON = '2026-11-15';

const contractor = (patch: Partial<ContractorFields>): ContractorFields => ({
  name: 'ОсОО «Ала-Тоо Трейд»',
  inn: '03744097401851',
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

describe.skipIf(!databaseAvailable())('Меню команд бота: данные (Т5)', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  const acc = { employeeId: '', userId: '' };
  let own = '';
  let other = '';
  let archived = '';
  let foreign = '';
  let n = 0;
  const ctxA = () => ({ orgId: a.orgId, userId: a.ownerUserId });
  const ctxB = () => ({ orgId: b.orgId, userId: b.ownerUserId });
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, ctxA(), fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, ctxB(), fn);

  async function link(ctx: { orgId: string; userId: string }, chatId: number) {
    const token = createHash('sha256').update(randomBytes(32)).digest('hex');
    await withOrgContext(db.app.db, ctx, (tx) => createTelegramLinkToken(tx, token));
    await withOrgContext(db.app.db, ctx, (tx) =>
      useTelegramLink(tx, { tokenHash: token, chatId, username: null, firstName: null }),
    );
  }
  /** Отчёт организации А (по умолчанию — НДС контрагента `own`, срок сегодня); возвращает id. */
  async function report(
    patch: Partial<typeof reports.$inferInsert>,
    org: CreatedOrganization = a,
  ): Promise<string> {
    const [row] = await db.admin.db
      .insert(reports)
      .values({
        orgId: org.orgId,
        contractorId: own,
        reportTypeCode: 'nds',
        act: 'both',
        period: 'M',
        periodStart: `20${String(10 + Math.floor(n / 12)).padStart(2, '0')}-${String((n++ % 12) + 1).padStart(2, '0')}-01`,
        eventDate: null,
        dueBase: TODAY,
        dueDate: TODAY,
        ...patch,
      })
      .returning({ id: reports.id });
    return row!.id;
  }
  const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id).sort();

  beforeAll(async () => {
    db = await createTestDatabase();
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedPermissions(db.admin.db, refDB.permissions, { update: false });
    await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: false });
    await seedAllPlatformDictionaries(db.admin.db);
    const org = (name: string, inn: string, slug: string, login: string) =>
      createOrganization(db.app.db, {
        name,
        inn,
        slug,
        owner: { fullName: `Владелец ${login}`, login, passwordHash: 'h' },
      });
    a = await org('Организация А', '01811201810456', 'cmd-a', 'cmd-owner-a');
    b = await org('Организация Б', '02811201810457', 'cmd-b', 'cmd-owner-b');
    Object.assign(
      acc,
      await inA(async (tx) => {
        const employeeId = await createEmployee(tx, {
          fullName: 'Токтогулов Алишер Бакытович',
          shortName: 'Алишер Т.',
          login: 'cmd-acc',
          passwordHash: 'x',
          phone: null,
          role: a.roles.find((r) => r.templateCode === 'acc')!,
        });
        const [row] = await tx
          .select({ userId: employees.userId })
          .from(employees)
          .where(eq(employees.id, employeeId));
        return { employeeId, userId: row!.userId };
      }),
    );
    await db.admin.db.update(users).set({ mustChangePassword: false });
    const cp = (patch: Partial<ContractorFields>) =>
      inA((tx) => createContractor(tx, a.orgId, contractor(patch), null));
    own = await cp({
      name: 'ОсОО «Ала-Тоо  Трейд»',
      inn: '03744097401851',
      responsibleEmployeeId: acc.employeeId,
    });
    other = await cp({ name: 'ИП Берёзов Трейд', inn: '03744097401852' });
    archived = await cp({ name: 'ОсОО «Трейд Архив»', inn: '03744097401853' });
    await db.admin.db
      .update(contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(contractors.id, archived));
    foreign = await inB((tx) =>
      createContractor(
        tx,
        b.orgId,
        contractor({ name: 'ОсОО «Чужой Трейд»', inn: '03744097401851' }),
        null,
      ),
    );
    await link(ctxA(), 7501);
    await link({ orgId: a.orgId, userId: acc.userId }, 7502);
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('учётные записи чата: непривязанный — пусто; общий чат — все записи; состояние записи', async () => {
    expect(await botChatUsers(db.app.db, 7999)).toEqual([]);
    expect(await botChatUsers(db.app.db, 7502)).toEqual([
      {
        userId: acc.userId,
        orgId: a.orgId,
        employeeId: acc.employeeId,
        orgName: 'Организация А',
        mustChangePassword: false,
        relinkFree: false,
        isPlatformAdmin: false,
        userBlocked: false,
        employeeActive: true,
        orgStatus: 'active',
      },
    ]);
    // Тот же Telegram привязан ещё и к владельцу организации Б.
    await link(ctxB(), 7501);
    const shared = await botChatUsers(db.app.db, 7501);
    expect(shared.map((u) => [u.userId, u.orgName])).toEqual([
      [a.ownerUserId, 'Организация А'],
      [b.ownerUserId, 'Организация Б'],
    ]);

    await db.admin.db
      .update(users)
      .set({ mustChangePassword: true, blocked: true })
      .where(eq(users.id, acc.userId));
    await db.admin.db
      .update(employees)
      .set({ active: false })
      .where(eq(employees.id, acc.employeeId));
    await db.admin.db
      .insert(telegramLinkGuards)
      .values({
        userId: acc.userId,
        orgId: a.orgId,
        freeUntil: new Date(Date.now() + 3_600_000),
      })
      .onConflictDoUpdate({
        target: telegramLinkGuards.userId,
        set: { freeUntil: new Date(Date.now() + 3_600_000) },
      });
    expect((await botChatUsers(db.app.db, 7502))[0]).toMatchObject({
      mustChangePassword: true,
      relinkFree: true,
      userBlocked: true,
      employeeActive: false,
    });
    await db.admin.db
      .update(users)
      .set({ mustChangePassword: false, blocked: false })
      .where(eq(users.id, acc.userId));
    await db.admin.db
      .update(employees)
      .set({ active: true })
      .where(eq(employees.id, acc.employeeId));
    await db.admin.db.delete(telegramLinkGuards).where(eq(telegramLinkGuards.userId, acc.userId));
  });

  it('отчёты команд: несданные и неоплаченные до конца недели, в области, без архива и чужой организации', async () => {
    const today = await report({});
    const overdue = await report({ dueDate: '2026-10-20', dueBase: '2026-10-20' });
    const sunday = await report({ dueDate: HORIZON, dueBase: HORIZON, status: 'needs_fix' });
    await report({ dueDate: '2026-11-16', dueBase: '2026-11-16' }); // после конца недели
    await report({ status: 'submitted' }); // сдан, платить нечего
    await report({ status: 'not_required' });
    await report({ superseded: true });
    // Сдан, но налог не оплачен: срок оплаты — сегодня.
    const pay = await report({ status: 'submitted', payDue: TODAY, amount: 50_000, paid: 10_000 });
    await report({ status: 'submitted', payDue: TODAY, amount: 50_000, paid: 50_000 });
    // «Уплата»: сдавать нечего, платить — да.
    const payOnly = await report({ act: 'pay', payDue: '2026-11-01', amount: 7_000 });
    // Только сдача: срок оплаты не считается.
    await report({ act: 'sub', status: 'submitted', payDue: TODAY, amount: 9_000 });
    // Контрагент без ответственного: отчёт закреплён за бухгалтером / ни за кем.
    const mine = await report({ contractorId: other, responsibleEmployeeId: acc.employeeId });
    const alien = await report({ contractorId: other });
    await report({ contractorId: archived });
    const inForeign = await report({ contractorId: foreign }, b);

    const all = await inA((tx) => commandReports(tx, { scope: undefined, horizon: HORIZON }));
    expect(ids(all)).toEqual([today, overdue, sunday, pay, payOnly, mine, alien].sort());
    expect(all.find((r) => r.id === pay)).toMatchObject({
      contractorId: own,
      contractorName: 'ОсОО «Ала-Тоо  Трейд»',
      typeShort: expect.any(String),
      period: 'M',
      act: 'both',
      status: 'submitted',
      payDue: TODAY,
      amount: 50_000,
      paid: 10_000,
    });
    // «Свои»: отчёты своих контрагентов и отчёты, где сотрудник — ответственный за отчёт.
    const scoped = await inA((tx) =>
      commandReports(tx, { scope: reportScope(acc.employeeId), horizon: HORIZON }),
    );
    expect(ids(scoped)).toEqual([today, overdue, sunday, pay, payOnly, mine].sort());
    // Чужая организация не видна — и из своей видна только своя.
    expect(
      ids(await inB((tx) => commandReports(tx, { scope: undefined, horizon: HORIZON }))),
    ).toEqual([inForeign]);
    await db.admin.db.delete(reports);
  });

  it('отчёты карточки: просроченные несданные и со сроком в этом месяце, без «Уплаты»', async () => {
    const overdue = await report({ dueDate: '2026-09-21', dueBase: '2026-09-21' });
    const later = await report({ dueDate: '2026-11-25', dueBase: '2026-11-25' });
    const done = await report({
      dueDate: '2026-11-02',
      dueBase: '2026-11-02',
      status: 'submitted',
    });
    await report({ dueDate: '2026-10-20', dueBase: '2026-10-20', status: 'submitted' });
    await report({ dueDate: '2026-12-01', dueBase: '2026-12-01' });
    await report({ act: 'pay', payDue: TODAY, amount: 1_000 });
    await report({ superseded: true });
    const elsewhere = await report({ contractorId: other });

    const card = (contractorId: string, scope = reportScope(null)) =>
      inA((tx) => commandCardReports(tx, { contractorId, scope, today: TODAY }));
    expect(ids(await card(own))).toEqual([overdue, later, done].sort());
    expect(ids(await card(other))).toEqual([elsewhere]);
    // Вне области отчёты контрагента не приходят; из чужой организации — тоже.
    expect(await card(other, reportScope(acc.employeeId))).toEqual([]);
    expect(
      await inB((tx) =>
        commandCardReports(tx, { contractorId: own, scope: undefined, today: TODAY }),
      ),
    ).toEqual([]);
    await db.admin.db.delete(reports);
  });

  it('поиск: часть названия без регистра и «ё», начало ИНН, область, без архива и чужих', async () => {
    const find = (query: string, scope = contractorScope(null), limit = 5) =>
      inA((tx) => findCommandContractors(tx, { scope, query, byInn: /^\d+$/.test(query), limit }));
    // «трейд» есть в трёх названиях организации А (одно — в архиве) и в одном чужом.
    expect(await find('трейд')).toEqual({
      total: 2,
      rows: [
        { id: other, name: 'ИП Берёзов Трейд' },
        { id: own, name: 'ОсОО «Ала-Тоо  Трейд»' },
      ],
    });
    expect((await find('березов')).rows).toEqual([{ id: other, name: 'ИП Берёзов Трейд' }]);
    // Пробелы подряд в названии — один, как в запросе.
    expect((await find('ала-тоо трейд')).rows.map((r) => r.id)).toEqual([own]);
    expect((await find('0374409740185')).total).toBe(2);
    expect((await find('03744097401852')).rows.map((r) => r.id)).toEqual([other]);
    // ИНН ищется только с начала.
    expect((await find('97401852')).total).toBe(0);
    expect((await find('%')).total).toBe(0);
    expect(await find('трейд', contractorScope(acc.employeeId))).toEqual({
      total: 1,
      rows: [{ id: own, name: 'ОсОО «Ала-Тоо  Трейд»' }],
    });
    expect(await find('трейд', undefined, 1)).toMatchObject({ total: 2, rows: [{ id: other }] });
    expect(
      await inB((tx) =>
        findCommandContractors(tx, { scope: undefined, query: 'трейд', byInn: false, limit: 5 }),
      ),
    ).toEqual({ total: 1, rows: [{ id: foreign, name: 'ОсОО «Чужой Трейд»' }] });
  });

  it('контрагент карточки: в области и не в архиве; чужой организации нет', async () => {
    const get = (id: string, scope = contractorScope(null)) =>
      inA((tx) => commandContractor(tx, id, scope));
    expect(await get(own)).toEqual({
      id: own,
      name: 'ОсОО «Ала-Тоо  Трейд»',
      oneOff: false,
      startDate: '2024-07-16',
      paused: false,
      responsibleName: 'Алишер Т.',
    });
    expect(await get(other)).toMatchObject({ responsibleName: null });
    expect(await get(other, contractorScope(acc.employeeId))).toBeNull();
    expect(await get(archived)).toBeNull();
    expect(await get(foreign)).toBeNull();
    expect(await get('не-uuid')).toBeNull();
    expect(await inB((tx) => commandContractor(tx, own, undefined))).toBeNull();
    await db.admin.db
      .update(contractors)
      .set({ serviceStatus: 'paused' })
      .where(eq(contractors.id, own));
    expect(await get(own)).toMatchObject({ paused: true });
    await db.admin.db
      .update(contractors)
      .set({ serviceStatus: 'active' })
      .where(eq(contractors.id, own));
  });
});
