import { randomUUID } from 'node:crypto';
import { hashPassword } from '@buhuchet/adapters/password';
import type { ListQuery } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActivitySpan } from './activity';
import {
  adminActivityByDay,
  adminOrgActivity,
  exportOrgActivity,
  listOrgActivityPage,
  listOrgActivityValues,
} from './admin-org-activity';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  auditLog,
  contractors,
  organizations,
  reports,
  sessionLog,
  statusHistory,
  users,
} from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

// Сегодня — четверг 12.11.2026; период — наступившая часть ноября 2026.
const NOVEMBER: ActivitySpan = { from: '2026-11-01', to: '2026-11-12' };

const t = (key: string) => key;
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

describe.skipIf(!databaseAvailable())('Админка → «Организации» → «Активность»: данные', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId = '';
  let blockedAdminId = '';
  let n = 0;
  const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, fn);

  const session = (
    org: CreatedOrganization | null,
    userId: string,
    started: string,
    seen: string,
    end?: { at: string; reason: string },
  ) =>
    db.admin.db.insert(sessionLog).values({
      id: randomUUID(),
      userId,
      orgId: org?.orgId ?? null,
      startedAt: at(started),
      lastSeenAt: at(seen),
      expiresAt: at('2027-01-01 00:00'),
      device: 'Chrome, Windows',
      endedAt: end ? at(end.at) : null,
      endReason: end?.reason ?? null,
    });
  const action = (org: CreatedOrganization, userId: string | null, when: string) =>
    db.admin.db.insert(auditLog).values({
      orgId: org.orgId,
      entity: 'contractor',
      entityId: `x-${++n}`,
      action: 'update',
      changes: [],
      actorUserId: userId,
      at: at(when),
    });
  const statusChange = (org: CreatedOrganization, userId: string, when: string, initial = false) =>
    db.admin.db.insert(statusHistory).values({
      orgId: org.orgId,
      scale: 'task',
      entityId: randomUUID(),
      fromStatus: initial ? null : 'todo',
      toStatus: initial ? 'todo' : 'done',
      actorUserId: userId,
      at: at(when),
    });

  beforeAll(async () => {
    db = await createTestDatabase();
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedPermissions(db.admin.db, refDB.permissions, { update: false });
    await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: false });
    await seedAllPlatformDictionaries(db.admin.db);
    const passwordHash = await hashPassword('Bh-4821-temp');
    const [admin, blocked] = await db.admin.db
      .insert(users)
      .values([
        { login: 'platform', passwordHash, isPlatformAdmin: true },
        { login: 'platform-old', passwordHash, isPlatformAdmin: true, blocked: true },
      ])
      .returning({ id: users.id });
    adminId = admin!.id;
    blockedAdminId = blocked!.id;
    a = await createOrganization(db.app.db, {
      name: 'ОсОО «Альфа»',
      inn: '01811201810456',
      slug: 'alfa',
      owner: { fullName: 'Асанов Асан', login: 'asanov', passwordHash },
    });
    b = await createOrganization(db.app.db, {
      name: 'ОсОО «Бета»',
      inn: '02811201810457',
      slug: 'beta',
      owner: { fullName: 'Бекова Бермет', login: 'bekova', passwordHash },
    });
    await db.admin.db
      .update(organizations)
      .set({ status: 'blocked', blockedReason: 'Заблокирована администратором' })
      .where(eq(organizations.id, b.orgId));

    // «Альфа»: два контрагента — один заведён в ноябре, другой раньше; отчёты: сдан в ноябре, «Уплата»
    // (сдачей не считается) и сдан в октябре.
    const cp = (name: string, inn: string) =>
      withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, (tx) =>
        createContractor(
          tx,
          a.orgId,
          contractor({ name, inn, responsibleEmployeeId: a.ownerEmployeeId }),
          null,
        ),
      );
    const fresh = await cp('ОсОО «Новый»', '03744097401851');
    const old = await cp('ОсОО «Давний»', '03744097401852');
    await db.admin.db
      .update(contractors)
      .set({ createdAt: at('2026-11-05 10:00') })
      .where(eq(contractors.id, fresh));
    await db.admin.db
      .update(contractors)
      .set({ createdAt: at('2026-10-31 23:59') })
      .where(eq(contractors.id, old));
    const report = (patch: Partial<typeof reports.$inferInsert>) =>
      db.admin.db.insert(reports).values({
        orgId: a.orgId,
        contractorId: fresh,
        reportTypeCode: 'nds',
        act: 'both',
        period: 'M',
        periodStart: `2020-${String((++n % 12) + 1).padStart(2, '0')}-01`,
        eventDate: null,
        dueBase: '2026-11-25',
        dueDate: '2026-11-25',
        responsibleEmployeeId: a.ownerEmployeeId,
        ...patch,
      });
    await report({ status: 'submitted', submittedOn: '2026-11-10' });
    await report({ act: 'pay', status: 'submitted', submittedOn: '2026-11-10' });
    await report({ status: 'submitted', submittedOn: '2026-10-30' });

    // История и журнал, созданные заведением записей, в расчёт не идут: тест считает свои события.
    await db.admin.sql`delete from audit_log`;
    await db.admin.sql`delete from status_history`;

    // «Альфа», владелец: 10.11 — вход, два действия, смена статуса той же операцией (не считается) и
    // отдельная смена статуса, выход; 11.11 — вход, сеанс открыт до 12.11 (12.11 — только обращения).
    await session(a, a.ownerUserId, '2026-11-10 09:00', '2026-11-10 18:00', {
      at: '2026-11-10 18:05',
      reason: 'logout',
    });
    await action(a, a.ownerUserId, '2026-11-10 10:00');
    await action(a, a.ownerUserId, '2026-11-10 11:00');
    await statusChange(a, a.ownerUserId, '2026-11-10 11:00');
    await statusChange(a, a.ownerUserId, '2026-11-10 12:00');
    await statusChange(a, a.ownerUserId, '2026-11-10 12:30', true);
    await session(a, a.ownerUserId, '2026-11-11 08:00', '2026-11-12 09:30');
    // Не считаются: «Система», администратор платформы (открыл карточку организации), прошлый месяц.
    await action(a, null, '2026-11-10 03:00');
    await action(a, adminId, '2026-11-10 13:00');
    await action(a, a.ownerUserId, '2026-10-31 23:59');
    // Сеанс администратора платформы — без организации.
    await session(null, adminId, '2026-11-10 12:00', '2026-11-10 12:30');
    // «Бета»: вход и действие 10.11.
    await session(b, b.ownerUserId, '2026-11-10 10:00', '2026-11-10 11:00');
    await action(b, b.ownerUserId, '2026-11-10 10:30');
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('числа организаций за период: пользователи, дни, входы, действия, сдано отчётов и новые контрагенты', async () => {
    expect(await asAdmin((tx) => adminOrgActivity(tx, NOVEMBER))).toEqual([
      {
        id: a.orgId,
        name: 'ОсОО «Альфа»',
        active: true,
        last: '2026-11-12 09:30',
        users: 1,
        staff: 1,
        days: 3,
        in: 2,
        n: 3,
        sub: 1,
        cps: 1,
      },
      {
        id: b.orgId,
        name: 'ОсОО «Бета»',
        active: false,
        last: '2026-11-10 11:00',
        users: 1,
        staff: 1,
        days: 1,
        in: 1,
        n: 1,
        sub: 0,
        cps: 0,
      },
    ]);
    expect([...(await asAdmin((tx) => adminActivityByDay(tx, NOVEMBER)))]).toEqual([
      ['2026-11-10', 4],
    ]);
    // Период без событий: организации в списке остаются, числа — нули.
    const empty = await asAdmin((tx) =>
      adminOrgActivity(tx, { from: '2026-12-01', to: '2026-12-31' }),
    );
    expect(empty.map((r) => [r.last, r.users, r.days, r.in, r.n, r.sub, r.cps])).toEqual([
      [null, 0, 0, 0, 0, 0, 0],
      [null, 0, 0, 0, 0, 0, 0],
    ]);
    // Октябрь: действие 31.10 в 23:59 по Бишкеку, отчёт и контрагент прошлого месяца.
    const october = await asAdmin((tx) =>
      adminOrgActivity(tx, { from: '2026-10-01', to: '2026-10-31' }),
    );
    expect(october[0]).toMatchObject({ last: '2026-10-31 23:59', days: 1, n: 1, sub: 1, cps: 1 });
  });

  it('не администратору платформы числа организаций не отдаются', async () => {
    const inOrg = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
      withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
    const calls = {
      activity: sql`select * from app.admin_org_activity('2026-11-01', '2026-11-12')`,
      byDay: sql`select * from app.admin_activity_by_day('2026-11-01', '2026-11-12')`,
    };
    // Обе функции — у администратора не пусто, у остальных пусто: владелец организации по учётной
    // записи и в контексте своей организации, заблокированный администратор, запрос без контекста.
    for (const [name, call] of Object.entries(calls)) {
      expect([...(await asAdmin((tx) => tx.execute(call)))].length, name).toBeGreaterThan(0);
      const denied = [
        await withUserContext(db.app.db, a.ownerUserId, (tx) => tx.execute(call)),
        await inOrg((tx) => tx.execute(call)),
        await withUserContext(db.app.db, blockedAdminId, (tx) => tx.execute(call)),
        await db.app.db.execute(call),
      ];
      expect(
        denied.map((rows) => [...rows].length),
        name,
      ).toEqual([0, 0, 0, 0]);
    }
    // То же — через функции модуля.
    expect(await inOrg((tx) => adminOrgActivity(tx, NOVEMBER))).toEqual([]);
    expect([...(await inOrg((tx) => adminActivityByDay(tx, NOVEMBER)))]).toEqual([]);
    expect(
      await withUserContext(db.app.db, blockedAdminId, (tx) => adminOrgActivity(tx, NOVEMBER)),
    ).toEqual([]);
    // Служебная функция с событиями организаций роли приложения закрыта — даже администратору:
    // права на неё нет («permission denied», 42501).
    const [granted] = await db.admin.sql<{ granted: boolean }[]>`
      select has_function_privilege('buhuchet_app', 'app.admin_org_events(date, date)', 'execute') as granted`;
    expect(granted!.granted).toBe(false);
    await expect(
      asAdmin((tx) =>
        tx.execute(sql`select * from app.admin_org_events('2026-11-01', '2026-11-12')`),
      ),
    ).rejects.toThrow(
      expect.objectContaining({ cause: expect.objectContaining({ code: '42501' }) }),
    );
  });

  it('список: по умолчанию — по «Действий» от больших; поиск, фильтр по статусу, значения и выгрузка', async () => {
    const page = await asAdmin((tx) => listOrgActivityPage(tx, query(), NOVEMBER, t));
    expect(page.total).toBe(2);
    expect(page.rows.map((r) => [r.name, r.n])).toEqual([
      ['ОсОО «Альфа»', 3],
      ['ОсОО «Бета»', 1],
    ]);
    expect(page.totals).toMatchObject({ users: 2, staff: 2, days: 4, in: 3, n: 4, sub: 1, cps: 1 });
    const sorted = await asAdmin((tx) =>
      listOrgActivityPage(tx, query({ sort: { key: 'n', dir: 'asc' } }), NOVEMBER, t),
    );
    expect(sorted.rows.map((r) => r.id)).toEqual([b.orgId, a.orgId]);
    const found = await asAdmin((tx) =>
      listOrgActivityPage(tx, query({ search: { q: 'бета', keys: ['name'] } }), NOVEMBER, t),
    );
    expect(found.rows.map((r) => r.id)).toEqual([b.orgId]);
    const blocked = await asAdmin((tx) =>
      listOrgActivityPage(
        tx,
        query({ filters: { st: { type: 'enum', vals: ['blocked'] } } }),
        NOVEMBER,
        t,
      ),
    );
    expect(blocked.rows.map((r) => r.id)).toEqual([b.orgId]);
    const statuses = await asAdmin((tx) => listOrgActivityValues(tx, 'st', NOVEMBER, t));
    expect(statuses.items.map((v) => v.value).sort()).toEqual(['active', 'blocked']);
    const file = await asAdmin((tx) =>
      exportOrgActivity(tx, query(), ['name', 'st', 'last', 'n'], NOVEMBER, t),
    );
    expect(file.rows).toEqual([
      ['ОсОО «Альфа»', 'orgs.active', '12.11.2026 09:30', 3],
      ['ОсОО «Бета»', 'orgs.blocked', '10.11.2026 11:00', 1],
    ]);
    // Не администратору список пуст.
    const foreign = await withUserContext(db.app.db, a.ownerUserId, (tx) =>
      listOrgActivityPage(tx, query(), NOVEMBER, t),
    );
    expect(foreign.total).toBe(0);
  });
});
