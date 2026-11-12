import { randomUUID } from 'node:crypto';
import { hashPassword } from '@buhuchet/adapters/password';
import { activityRows, type ListQuery } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activityContractors,
  activityCounters,
  activityDays,
  activityStaff,
  activityStaffMember,
  activitySubmittedByDay,
  exportActivity,
  listActivityPage,
  listActivityValues,
  type ActivityWindow,
} from './activity';
import { withOrgContext } from './context';
import { contractorScope, createContractor, type ContractorFields } from './contractors';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  auditLog,
  contractors,
  employees,
  reports,
  sessionLog,
  statusHistory,
  tasks,
} from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { createEmployee } from './staff';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

// Сегодня — четверг 12.11.2026; период — ноябрь 2026.
const TODAY = '2026-11-12';
const NOVEMBER: ActivityWindow = {
  range: { from: '2026-11-01', to: '2026-11-30' },
  span: { from: '2026-11-01', to: TODAY },
  today: TODAY,
};

const query = (patch: Partial<ListQuery> = {}): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {}, ...patch }) as ListQuery;

const contractor = (patch: Partial<ContractorFields> = {}): ContractorFields => ({
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

/** Момент по Бишкеку: «2026-11-10 09:05» → Date. */
const at = (text: string) => new Date(`${text.replace(' ', 'T')}:00+06:00`);

describe.skipIf(!databaseAvailable())('«Главная» → «Активность»: данные', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  const acc = { employeeId: '', userId: '' };
  const chief = { employeeId: '', userId: '' };
  let cp1 = '';
  let cp2 = '';
  let cpArchived = '';
  let n = 0;
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);

  /** Сеанс в журнале: вход, последнее обращение и, если закрыт, чем и когда. */
  const session = (
    org: CreatedOrganization,
    userId: string,
    started: string,
    seen: string,
    end?: { at: string; reason: string },
  ) =>
    db.admin.db.insert(sessionLog).values({
      id: randomUUID(),
      userId,
      orgId: org.orgId,
      startedAt: at(started),
      lastSeenAt: at(seen),
      expiresAt: at('2027-01-01 00:00'),
      device: 'Chrome, Windows',
      endedAt: end ? at(end.at) : null,
      endReason: end?.reason ?? null,
    });
  const action = (
    org: CreatedOrganization,
    userId: string | null,
    when: string,
    contractorId: string | null = null,
  ) =>
    db.admin.db.insert(auditLog).values({
      orgId: org.orgId,
      entity: 'contractor',
      entityId: `x-${++n}`,
      action: 'update',
      changes: [],
      contractorId,
      actorUserId: userId,
      at: at(when),
    });
  const report = (patch: Partial<typeof reports.$inferInsert>) =>
    db.admin.db.insert(reports).values({
      orgId: a.orgId,
      contractorId: cp1,
      reportTypeCode: 'nds',
      act: 'both',
      period: 'M',
      periodStart: `2020-${String((++n % 12) + 1).padStart(2, '0')}-01`,
      eventDate: null,
      dueBase: '2026-11-25',
      dueDate: '2026-11-25',
      responsibleEmployeeId: acc.employeeId,
      ...patch,
    });

  beforeAll(async () => {
    db = await createTestDatabase();
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedPermissions(db.admin.db, refDB.permissions, { update: false });
    await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: false });
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = async (login: string) => ({
      fullName: 'Владелец Организации',
      login,
      passwordHash: await hashPassword('Bh-4821-temp'),
    });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'act-a',
      owner: await owner('act-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'act-b',
      owner: await owner('act-owner-b'),
    });
    const role = (code: string) => a.roles.find((r) => r.templateCode === code)!;
    const add = (login: string, fullName: string, shortName: string, code: string) =>
      inA(async (tx) => {
        const employeeId = await createEmployee(tx, {
          fullName,
          shortName,
          login,
          passwordHash: 'x',
          phone: null,
          role: role(code),
        });
        const [row] = await tx
          .select({ userId: employees.userId })
          .from(employees)
          .where(eq(employees.id, employeeId));
        return { employeeId, userId: row!.userId };
      });
    Object.assign(acc, await add('act-acc', 'Токтогулов Алишер Бакытович', 'Алишер Т.', 'acc'));
    Object.assign(chief, await add('act-chief', 'Кадырова Мээрим Асановна', 'Мээрим К.', 'chief'));
    const cp = (name: string, inn: string) =>
      inA((tx) =>
        createContractor(
          tx,
          a.orgId,
          contractor({ name, inn, responsibleEmployeeId: acc.employeeId }),
          null,
        ),
      );
    cp1 = await cp('ОсОО «Ала-Тоо Трейд»', '03744097401851');
    cp2 = await cp('ОсОО «Бишкек Сервис»', '03744097401852');
    cpArchived = await cp('ОсОО «Архив»', '03744097401853');
    await db.admin.db
      .update(contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(contractors.id, cpArchived));
    // История и журнал, созданные заведением записей, в расчёт не идут: тест считает свои события.
    await db.admin.sql`delete from audit_log`;
    await db.admin.sql`delete from status_history`;

    // Бухгалтер: 10.11 — вход 09:05, три действия, выход 18:10; 11.11 — вход в 01:30 по Бишкеку
    // (10.11 19:30 UTC), сеанс истёк; 12.11 — только обращения открытого сеанса.
    await session(a, acc.userId, '2026-11-10 09:05', '2026-11-10 18:09', {
      at: '2026-11-10 18:10',
      reason: 'logout',
    });
    await action(a, acc.userId, '2026-11-10 09:30', cp1);
    await action(a, acc.userId, '2026-11-10 12:00', cp1);
    await action(a, acc.userId, '2026-11-10 17:45', cp2);
    await session(a, acc.userId, '2026-11-11 01:30', '2026-11-11 02:00', {
      at: '2026-11-11 23:00',
      reason: 'expired',
    });
    await session(a, acc.userId, '2026-11-11 08:40', '2026-11-12 10:20');
    // Смена статуса — действие; начальный статус новой записи — нет.
    const [taskRow] = await db.admin.db
      .insert(tasks)
      .values({
        orgId: a.orgId,
        title: 'Собрать первичку',
        categoryCode: 'КАТ-001',
        contractorId: cp2,
        executorEmployeeId: acc.employeeId,
        authorEmployeeId: chief.employeeId,
        dueDate: '2026-11-11',
        confirm: false,
        status: 'done',
        doneAt: at('2026-11-11 15:00'),
      })
      .returning({ id: tasks.id });
    await db.admin.db.insert(statusHistory).values([
      {
        orgId: a.orgId,
        scale: 'task',
        entityId: taskRow!.id,
        fromStatus: null,
        toStatus: 'todo',
        actorUserId: chief.userId,
        at: at('2026-11-11 09:00'),
      },
      {
        orgId: a.orgId,
        scale: 'task',
        entityId: taskRow!.id,
        fromStatus: 'todo',
        toStatus: 'done',
        actorUserId: acc.userId,
        at: at('2026-11-11 15:00'),
      },
    ]);
    // Смена статуса той же операцией, что и запись истории (то же время транзакции), — одно действие.
    await db.admin.db.insert(statusHistory).values({
      orgId: a.orgId,
      scale: 'task',
      entityId: taskRow!.id,
      fromStatus: 'done',
      toStatus: 'todo',
      actorUserId: acc.userId,
      at: at('2026-11-10 12:00'),
    });
    // Действие системы и действие прошлого месяца в ноябрь не попадают.
    await action(a, null, '2026-11-10 03:00');
    await action(a, acc.userId, '2026-10-31 23:59');
    // Главный бухгалтер: одно действие 03.11.
    await action(a, chief.userId, '2026-11-03 11:11');
    // Организация Б: свои вход и действие.
    await session(b, b.ownerUserId, '2026-11-10 10:00', '2026-11-10 11:00');
    await action(b, b.ownerUserId, '2026-11-10 10:30');

    // Отчёты бухгалтера: сдан в срок им самим; сдан позже срока главным бухгалтером; сдан без
    // записи «кто сдал»; «Уплата» сдачей не считается; два несданных со сроком в ноябре — один уже
    // просрочен; «Не требуется» и прежняя версия в «срок в периоде» не идут.
    await report({
      status: 'submitted',
      submittedOn: '2026-11-10',
      submittedBy: acc.userId,
      dueDate: '2026-11-20',
    });
    await report({
      status: 'submitted',
      submittedOn: '2026-11-11',
      submittedBy: chief.userId,
      dueDate: '2026-11-05',
    });
    await report({
      contractorId: cp2,
      status: 'submitted',
      submittedOn: '2026-11-11',
      submittedBy: null,
      dueDate: '2026-11-20',
    });
    await report({
      act: 'pay',
      status: 'submitted',
      submittedOn: '2026-11-11',
      submittedBy: acc.userId,
      dueDate: '2026-11-20',
    });
    // Возвращён на исправление: день сдачи остался — в «сдано» считается.
    await report({
      status: 'needs_fix',
      submittedOn: '2026-11-12',
      submittedBy: acc.userId,
      dueDate: '2026-11-20',
    });
    await report({ status: 'todo', dueDate: '2026-11-25' });
    await report({ contractorId: cp2, status: 'in_progress', dueDate: '2026-11-09' });
    await report({ status: 'not_required', dueDate: '2026-11-20' });
    await report({ status: 'todo', dueDate: '2026-11-20', superseded: true });
    await report({ status: 'todo', dueDate: '2026-10-20' });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('дни сотрудника: действия из истории и смен статусов, входы, выходы кнопкой «Выйти», первый вход и последняя активность по Бишкеку', async () => {
    const days = await inA((tx) => activityDays(tx, NOVEMBER.span));
    expect(days.get(acc.userId)).toEqual([
      { day: '2026-11-10', n: 3, in: 1, out: 1, first: '09:05', last: '18:10' },
      // Вход 10.11 в 19:30 UTC — это уже 11.11 по Бишкеку; истёкший сеанс выходом не считается.
      { day: '2026-11-11', n: 1, in: 2, out: 0, first: '01:30', last: '15:00' },
      // 12.11 — только обращения открытого сеанса: день с активностью без входов и действий.
      { day: '2026-11-12', n: 0, in: 0, out: 0, first: null, last: '10:20' },
    ]);
    // Начальный статус новой задачи отдельным действием не считается.
    expect(days.get(chief.userId)).toEqual([
      { day: '2026-11-03', n: 1, in: 0, out: 0, first: null, last: '11:11' },
    ]);
    expect(days.has(a.ownerUserId)).toBe(false);
  });

  it('период обрезает события: день, один пользователь, пустой период', async () => {
    const one = await inA((tx) =>
      activityDays(tx, { from: '2026-11-10', to: '2026-11-10' }, acc.userId),
    );
    expect([...one.keys()]).toEqual([acc.userId]);
    expect(one.get(acc.userId)!.map((d) => d.day)).toEqual(['2026-11-10']);
    const october = await inA((tx) => activityDays(tx, { from: '2026-10-01', to: '2026-10-31' }));
    expect(october.get(acc.userId)).toEqual([
      { day: '2026-10-31', n: 1, in: 0, out: 0, first: null, last: '23:59' },
    ]);
    expect(await inA((tx) => activityDays(tx, { from: '2026-12-01', to: '2026-11-30' }))).toEqual(
      new Map(),
    );
  });

  it('чужая организация не видна: журнал сеансов, действия и сотрудники', async () => {
    const days = await inB((tx) => activityDays(tx, NOVEMBER.span));
    expect([...days.keys()]).toEqual([b.ownerUserId]);
    expect(days.get(b.ownerUserId)).toEqual([
      { day: '2026-11-10', n: 1, in: 1, out: 0, first: '10:00', last: '11:00' },
    ]);
    const seen = await inB((tx) =>
      tx.execute<{ user_id: string }>(sql`select user_id from app.org_sessions`),
    );
    expect([...seen].map((r) => r.user_id)).toEqual([b.ownerUserId]);
    expect((await inB((tx) => activityStaff(tx))).map((e) => e.id)).toEqual([b.ownerEmployeeId]);
    expect(await inB((tx) => activityStaffMember(tx, acc.employeeId))).toBeNull();
    expect(await inB((tx) => activityCounters(tx, NOVEMBER))).toEqual(new Map());
    // Сеанс администратора платформы (без организации) не виден ни одной организации.
    await db.admin.db.insert(sessionLog).values({
      id: randomUUID(),
      userId: a.ownerUserId,
      orgId: null,
      startedAt: at('2026-11-10 12:00'),
      lastSeenAt: at('2026-11-10 12:30'),
      expiresAt: at('2027-01-01 00:00'),
      device: 'Chrome, Windows',
    });
    const again = await inB((tx) =>
      tx.execute<{ user_id: string }>(sql`select user_id from app.org_sessions`),
    );
    expect([...again].map((r) => r.user_id)).toEqual([b.ownerUserId]);
    expect((await inA((tx) => activityDays(tx, NOVEMBER.span))).has(a.ownerUserId)).toBe(false);
    // Без организации в контексте представление пусто, а сама таблица журнала закрыта.
    expect([...(await db.app.db.execute(sql`select user_id from app.org_sessions`))]).toEqual([]);
    await expect(db.app.db.execute(sql`select 1 from public.session_log`)).rejects.toThrow();
    // В представлении — только нужное для подсчёта: ни номера сеанса, ни устройства, ни срока, ни
    // причины конца; писать через него роль приложения не может.
    const columns = await db.admin.sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'app' and table_name = 'org_sessions' order by ordinal_position`;
    expect(columns.map((c) => c.column_name)).toEqual([
      'user_id',
      'started_at',
      'last_seen_at',
      'ended_at',
      'logged_out',
    ]);
    await expect(
      inB((tx) => tx.execute(sql`update app.org_sessions set started_at = now()`)),
    ).rejects.toThrow();
    await expect(inB((tx) => tx.execute(sql`delete from app.org_sessions`))).rejects.toThrow();
  });

  it('числа сотрудника: сдано — у того, кто сдал (не записано — у ответственного), срок в периоде, просрочено сейчас, контрагенты не в архиве, задачи', async () => {
    const counters = await inA((tx) => activityCounters(tx, NOVEMBER));
    expect(counters.get(acc.employeeId)).toEqual({
      // Сданы: им самим, без записи «кто сдал» и возвращённый на исправление.
      sub: 3,
      late: 0,
      // В срок в ноябре: три сданных, возвращённый на исправление и два несданных; «Уплата»,
      // «Не требуется» и прежняя версия — нет.
      due: 6,
      // Просрочены сейчас: со сроком 09.11 и 20.10 (и прежняя версия — открытая и со сроком в будущем — нет).
      over: 2,
      cps: 2,
      tasks: 1,
    });
    expect(counters.get(chief.employeeId)).toEqual({
      sub: 1,
      late: 1,
      due: 0,
      over: 0,
      cps: 0,
      tasks: 0,
    });
  });

  it('сдано по дням и строки «По контрагентам» окна сотрудника', async () => {
    const [member] = (await inA((tx) => activityStaff(tx))).filter((e) => e.id === acc.employeeId);
    expect(member).toMatchObject({
      name: 'Токтогулов Алишер Бакытович',
      role: 'Бухгалтер',
      active: true,
      userId: acc.userId,
    });
    expect(await inA((tx) => activityStaffMember(tx, acc.employeeId))).toEqual(member);
    const byDay = await inA((tx) => activitySubmittedByDay(tx, NOVEMBER.span, acc.employeeId));
    expect([...byDay].sort()).toEqual([
      ['2026-11-10', 1],
      ['2026-11-11', 1],
      ['2026-11-12', 1],
    ]);
    const all = await inA((tx) => activityContractors(tx, NOVEMBER, member!, undefined));
    expect(all).toEqual([
      {
        id: cp1,
        name: 'ОсОО «Ала-Тоо Трейд»',
        sub: 2,
        due: 4,
        open: 2,
        over: 1,
        act: 2,
        inScope: true,
      },
      {
        id: cp2,
        name: 'ОсОО «Бишкек Сервис»',
        sub: 1,
        due: 2,
        open: 1,
        over: 1,
        act: 2,
        inScope: true,
      },
    ]);
    // Тот, кто смотрит, видит только своих контрагентов: чужие карточки не открываются.
    const scoped = await inA((tx) =>
      activityContractors(tx, NOVEMBER, member!, contractorScope(chief.employeeId)),
    );
    expect(scoped.map((c) => c.inScope)).toEqual([false, false]);
  });

  it('список: по умолчанию — по «Действий» от больших; поиск, фильтр, значения столбца и выгрузка', async () => {
    const rows = await inA(async (tx) => {
      const staff = await activityStaff(tx);
      const days = await activityDays(tx, NOVEMBER.span);
      const counters = await activityCounters(tx, NOVEMBER);
      return activityRows(
        staff,
        new Map(staff.map((e) => [e.id, days.get(e.userId) ?? []])),
        counters,
      );
    });
    expect(rows).toHaveLength(3);
    const page = await inA((tx) => listActivityPage(tx, query(), rows));
    expect(page.rows.map((r) => [r.name, r.n, r.days, r.last])).toEqual([
      ['Токтогулов Алишер Бакытович', 4, 3, '2026-11-12 10:20'],
      ['Кадырова Мээрим Асановна', 1, 1, '2026-11-03 11:11'],
      ['Владелец Организации', 0, 0, null],
    ]);
    expect(page.total).toBe(3);
    const found = await inA((tx) =>
      listActivityPage(tx, query({ search: { q: 'мээрим', keys: ['fio', 'role'] } }), rows),
    );
    expect(found.rows.map((r) => r.id)).toEqual([chief.employeeId]);
    const filtered = await inA((tx) =>
      listActivityPage(
        tx,
        query({ filters: { role: { type: 'enum', vals: ['Бухгалтер'] } } }),
        rows,
      ),
    );
    expect(filtered.rows.map((r) => r.id)).toEqual([acc.employeeId]);
    const roles = await inA((tx) => listActivityValues(tx, 'role', rows));
    expect(roles.items.map((v) => v.value).sort()).toEqual(
      ['Бухгалтер', 'Владелец организации', 'Главный бухгалтер'].sort(),
    );
    const file = await inA((tx) => exportActivity(tx, query(), ['fio', 'last', 'n', 'sub'], rows));
    expect(file.rows[0]).toEqual(['Токтогулов Алишер Бакытович', '12.11.2026 10:20', 4, 3]);
  });
});
