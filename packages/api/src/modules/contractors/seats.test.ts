import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { formatText, UI_TEXTS, type UiTextKey } from '@buhuchet/domain';
import {
  ApiError,
  ArchiveContractorsResult,
  Contractor,
  ContractorImportCheck,
  ContractorSeats,
  NoSeatsDetails,
} from '@buhuchet/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiRequest,
  createStaffFixture,
  signIn,
  TEST_PASSWORD,
  TEST_SUBSCRIPTION,
} from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

// Места в пакете (доработки 20.11.2026, блок 3, пункт 1; этап 1, П8; прототип v152 seatOk, seatDlg):
// пакет заполнен — «Новый контрагент», загрузка из Excel и «Вернуть из архива» отказывают 409
// `no_seats`; «В архиве» место освобождает. Сегодня в тестах — 18.10.2026 (`createTestDeps`).
describe.skipIf(!databaseAvailable())('Контрагенты: места в пакете', () => {
  let f: Fixture;
  let owner: string;
  let acc: string;
  let ownerB: string;
  let innSeq = 700;

  const nextInn = () => `0374409740${String(innSeq++).padStart(4, '0')}`;
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  /** Что покажет экран: текст словаря по коду ошибки с подстановками из подробностей. */
  const screen = ({ code, details }: { code: string; details?: unknown }) =>
    formatText(UI_TEXTS[`err.${code}` as UiTextKey].ru, details as Record<string, string | number>);
  const body = (o: { inn?: string; resp?: string } = {}) => ({
    name: `ОсОО «Место ${innSeq}»`,
    inn: o.inn ?? nextInn(),
    phone: '+996505890076',
    kind: 'regular',
    formCode: 'ФС-01',
    regimeCode: 'РЕЖ-01',
    gked: '46.34.0',
    gkedExtra: [],
    bases: [],
    startDate: '2026-10-01',
    responsibleEmployeeId: f.people[o.resp ?? 'acc-a']!.employeeId,
  });
  const create = (cookie: string, o?: { inn?: string; resp?: string }) =>
    apiRequest(f.app, 'POST', '/api/contractors', cookie, body(o));
  const seats = async (cookie: string) => {
    const res = await apiRequest(f.app, 'GET', '/api/contractors/seats', cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    return ContractorSeats.parse(await res.json());
  };
  /** Активные контрагенты организации А — все, кроме «В архиве». */
  const active = async () =>
    (
      await f.t.admin.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.contractors)
        .where(
          and(
            eq(schema.contractors.orgId, f.a.orgId),
            ne(schema.contractors.serviceStatus, 'archived'),
          ),
        )
    )[0]!.n;
  /** Пакет организации А: `free` свободных мест сверх занятых сейчас. */
  const pack = async (free: number) => {
    const seatsNow = (await active()) + free;
    await f.t.admin.db
      .insert(schema.orgSubscriptions)
      .values({ orgId: f.a.orgId, planId: 'm1', seats: seatsNow, paidUntil: '2026-12-31' })
      .onConflictDoUpdate({
        target: schema.orgSubscriptions.orgId,
        set: { seats: seatsNow, nextSeats: null, nextFrom: null },
      });
    return seatsNow;
  };
  const importRow = (name: string) => [
    name,
    nextInn(),
    '+996 555 404 404',
    'НДС',
    '15000',
    'acc-a',
    'ОНР',
    '69.20.0',
  ];
  const MAP = ['name', 'inn', 'phone', 'types', 'fee', 'resp', 'regime', 'gked'];

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    [owner, acc, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
    for (const cookie of [owner, ownerB]) {
      const res = await apiRequest(f.app, 'POST', '/api/org-report-types/connect', cookie, {
        connect: ['nds', 'nspm', 'npa', 'enq', 'endo', 'soc'],
        disconnect: [],
      });
      expect(res.status, await res.clone().text()).toBe(200);
    }
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('«Места в пакете»: без входа — 401; у каждой организации свой пакет; владелец ли спрашивает', async () => {
    expect((await apiRequest(f.app, 'GET', '/api/contractors/seats')).status).toBe(401);
    // Организация Б — с подпиской фикстуры: свой пакет, контрагентов пока нет. «Нет подписки» закрывает
    // вход (общая сборка этапа 1, п. О-89), поэтому места без подписки не спрашиваются.
    const packB = { used: 0, limit: TEST_SUBSCRIPTION.seats, free: TEST_SUBSCRIPTION.seats };
    expect(await seats(ownerB)).toEqual({ seats: packB, owner: true });
    const limit = await pack(2);
    expect(await seats(owner)).toEqual({
      seats: { used: limit - 2, limit, free: 2 },
      owner: true,
    });
    expect((await seats(acc)).owner).toBe(false);
  });

  it('«Новый контрагент»: последнее место занимается, дальше — 409 no_seats с числами', async () => {
    const limit = await pack(1);
    const ok = await create(owner);
    expect(ok.status, await ok.clone().text()).toBe(201);
    const full = await create(owner);
    expect(full.status).toBe(409);
    const err = await failure(full);
    expect(err.code).toBe('no_seats');
    expect(NoSeatsDetails.parse(err.details)).toEqual({
      used: limit,
      limit,
      free: 0,
      need: 1,
      owner: true,
    });
    expect(screen(err)).toBe(
      `В пакете нет свободных мест: занято ${limit} из ${limit}. Расширьте пакет или переведите контрагента в архив`,
    );
    expect(err.message).toBe(screen(err));
    // Сотрудник видит те же числа, «Расширить пакет» — только у владельца.
    const byAcc = await failure(await create(acc));
    expect(byAcc.code).toBe('no_seats');
    expect(NoSeatsDetails.parse(byAcc.details).owner).toBe(false);
    expect(await active()).toBe(limit);
  });

  it('чужая организация: полный пакет А организации Б не виден и не мешает; без права «Просматривать контрагентов» — 403', async () => {
    await pack(0);
    // Числа Б — только свои: полный пакет А их не меняет.
    expect(await seats(ownerB)).toEqual({
      seats: { used: 0, limit: TEST_SUBSCRIPTION.seats, free: TEST_SUBSCRIPTION.seats },
      owner: true,
    });
    const inB = await create(ownerB, { resp: 'acc-b' });
    expect(inB.status, await inB.clone().text()).toBe(201);
    expect((await failure(await create(owner))).code).toBe('no_seats');

    const [senior] = await f.t.admin.db
      .select({ roleId: schema.employees.roleId })
      .from(schema.employees)
      .where(eq(schema.employees.id, f.people['senior-a']!.employeeId));
    const cpView = and(
      eq(schema.rolePermissions.roleId, senior!.roleId),
      eq(schema.rolePermissions.permissionId, 'cpView'),
    );
    await f.t.admin.db.delete(schema.rolePermissions).where(cpView);
    try {
      const cookie = await signIn(f.app, 'senior-a', TEST_PASSWORD);
      expect((await apiRequest(f.app, 'GET', '/api/contractors/seats', cookie)).status).toBe(403);
    } finally {
      await f.t.admin.db
        .insert(schema.rolePermissions)
        .values({ orgId: f.a.orgId, roleId: senior!.roleId, permissionId: 'cpView' });
    }
  });

  it('два «Новый контрагент» одновременно на последнее место: создаётся ровно один', async () => {
    const limit = await pack(1);
    const both = await Promise.all([create(owner), create(owner)]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    const refused = both.find((r) => r.status === 409)!;
    expect((await failure(refused)).code).toBe('no_seats');
    expect(await active()).toBe(limit);
  });

  it('пакет полон, ИНН — у контрагента в архиве: отказ «такой ИНН уже есть (в архиве)», а не «нет мест»', async () => {
    await pack(1);
    const inn = nextInn();
    const first = await create(owner, { inn });
    expect(first.status).toBe(201);
    const cp = Contractor.parse(await first.json());
    const archived = await apiRequest(f.app, 'POST', '/api/contractors/archive', owner, {
      ids: [cp.id],
    });
    expect(archived.status).toBe(200);
    await pack(0);
    const again = await create(owner, { inn });
    expect(again.status).toBe(409);
    const err = await failure(again);
    expect(err.code).toBe('inn_duplicate');
    expect(err.details).toMatchObject({ archived: true, variant: 'archived' });
  });

  it('«В архиве» освобождает место; «Вернуть из архива» при полном пакете — 409, контрагент в архиве', async () => {
    await pack(1);
    const first = await create(owner);
    expect(first.status).toBe(201);
    const cp = Contractor.parse(await first.json());
    const archived = await apiRequest(f.app, 'POST', '/api/contractors/archive', owner, {
      ids: [cp.id],
    });
    expect(archived.status, await archived.clone().text()).toBe(200);
    expect(ArchiveContractorsResult.parse(await archived.json()).archived).toBe(1);
    expect((await seats(owner)).seats?.free).toBe(1);
    expect((await create(owner)).status).toBe(201);

    const back = await apiRequest(f.app, 'POST', `/api/contractors/${cp.id}/unarchive`, owner, {});
    expect(back.status).toBe(409);
    expect((await failure(back)).code).toBe('no_seats');
    const [row] = await f.t.admin.db
      .select({ status: schema.contractors.serviceStatus })
      .from(schema.contractors)
      .where(eq(schema.contractors.id, cp.id));
    expect(row!.status).toBe('archived');

    await pack(1);
    const again = await apiRequest(f.app, 'POST', `/api/contractors/${cp.id}/unarchive`, owner, {});
    expect(again.status, await again.clone().text()).toBe(200);
    expect((await seats(owner)).seats?.free).toBe(0);
  });

  it('Загрузка из Excel: в предпросмотре места; новых больше свободных — не создаётся ни один', async () => {
    const limit = await pack(1);
    const rows = [importRow('ОсОО «Пакет Один»'), importRow('ОсОО «Пакет Два»')];
    const check = await apiRequest(f.app, 'POST', '/api/contractors/import/check', owner, {
      map: MAP,
      rows,
    });
    expect(check.status, await check.clone().text()).toBe(200);
    const plan = ContractorImportCheck.parse(await check.json());
    expect(plan.ready).toBe(2);
    expect(plan.seats).toEqual({ seats: { used: limit - 1, limit, free: 1 }, owner: true });

    const apply = await apiRequest(f.app, 'POST', '/api/contractors/import', owner, {
      map: MAP,
      rows,
    });
    expect(apply.status).toBe(409);
    const err = await failure(apply);
    expect(err.code).toBe('no_seats');
    expect(NoSeatsDetails.parse(err.details)).toMatchObject({ free: 1, need: 2 });
    expect(await active()).toBe(limit - 1);

    await pack(2);
    const done = await apiRequest(f.app, 'POST', '/api/contractors/import', owner, {
      map: MAP,
      rows,
    });
    expect(done.status, await done.clone().text()).toBe(200);
    expect((await seats(owner)).seats?.free).toBe(0);
  });
});
