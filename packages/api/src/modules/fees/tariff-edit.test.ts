import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { ApiError, ContractorFees, TariffEdited } from '@buhuchet/shared';
import { and, desc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/** Сомы в тыйынах. */
const som = (n: number) => n * 100;

/*
 * «Изменить ставку обслуживания» и «Удалить ставку» (прототип v86 modules/contractor-card.js
 * `tariffEditDlg`; docs/deviations.md п. О-78). Сегодня в тестах — 18.10.2026 (`createTestDeps`).
 */
describe.skipIf(!databaseAvailable())('Журнал тарифов: правка и удаление ставки (v86)', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let acc: string;
  let ownerB: string;
  let cp = '';
  let cpFuture = '';
  let cpOne = '';
  let cpArchived = '';

  const call = (method: 'GET' | 'POST' | 'PUT', path: string, cookie: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const expectStatus = async (res: Response, status: number) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return res;
  };
  const fees = async (cookie: string, id: string) =>
    ContractorFees.parse(
      await (
        await expectStatus(await call('GET', `/api/contractors/${id}/fees`, cookie), 200)
      ).json(),
    );
  const edit = (cookie: string, id: string, tariffId: string, body: Record<string, unknown>) =>
    call('PUT', `/api/contractors/${id}/tariffs/${tariffId}`, cookie, {
      amount: som(30_000),
      period: 'M',
      from: '2026-07',
      reason: 'ставку внесли с ошибкой',
      version: 1,
      ...body,
    });
  const remove = (cookie: string, id: string, tariffId: string, body: Record<string, unknown>) =>
    call('POST', `/api/contractors/${id}/tariffs/${tariffId}/delete`, cookie, {
      reason: 'внесли по ошибке',
      version: 1,
      ...body,
    });
  /** Последняя запись истории контрагента. */
  const lastHistory = async (id: string) => {
    const [row] = await f.t.admin.db
      .select({ changes: schema.auditLog.changes, reason: schema.auditLog.reason })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entity, 'contractor'), eq(schema.auditLog.entityId, id)))
      .orderBy(desc(schema.auditLog.id))
      .limit(1);
    return row;
  };

  async function contractor(
    name: string,
    inn: string,
    tariffs: readonly { amount: number; validFrom: string }[],
    patch: Partial<typeof schema.contractors.$inferInsert> = {},
  ) {
    const [row] = await f.t.admin.db
      .insert(schema.contractors)
      .values({
        orgId: f.a.orgId,
        name,
        inn,
        phone: '+996505890076',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        startDate: '2026-07-10',
        feeDay: 15,
        firstMonthMode: 'full',
        paysTo: 'org',
        createdAt: new Date('2026-06-20T10:00:00+06:00'),
        ...patch,
      })
      .returning({ id: schema.contractors.id });
    if (tariffs.length) {
      await f.t.admin.db.insert(schema.contractorTariffs).values(
        tariffs.map((t) => ({
          orgId: f.a.orgId,
          contractorId: row!.id,
          amount: t.amount,
          period: 'M' as const,
          validFrom: t.validFrom,
        })),
      );
    }
    return row!.id;
  }

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    for (const orgId of [f.a.orgId, f.b.orgId]) {
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: { fee: true } })
        .where(eq(schema.orgSettings.orgId, orgId));
    }
    [owner, chief, acc, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
    // Обслуживание с 10.07.2026: июль — неполный месяц, ставка 30 000 с июля и 40 000 с ноября.
    cp = await contractor('ОсОО «Ала-Тоо Трейд»', '03744097401851', [
      { amount: som(30_000), validFrom: '2026-07-01' },
      { amount: som(40_000), validFrom: '2026-11-01' },
    ]);
    cpFuture = await contractor('ИП Садыкова', '21503198700015', [
      { amount: som(10_000), validFrom: '2026-12-01' },
    ]);
    cpOne = await contractor('ИП Разовый', '21503198700023', [], { kind: 'oneoff' });
    cpArchived = await contractor(
      'ОсОО «Архив»',
      '03744097401853',
      [{ amount: som(5_000), validFrom: '2026-07-01' }],
      { serviceStatus: 'archived' },
    );
  }, 120_000);

  it('вкладка: у записей журнала — версия, первая ставка, поле первого месяца, можно ли удалить', async () => {
    const v = await fees(chief, cp);
    expect(v.canEditTariff).toBe(true);
    expect(v.contractor.firstMonth).toBe('full');
    expect(
      v.tariffs.map((x) => [
        x.from,
        x.version,
        x.edited,
        x.first,
        x.firstMonthEditable,
        x.deletable,
      ]),
    ).toEqual([
      ['2026-11', 1, null, false, false, true],
      ['2026-07', 1, null, true, true, false],
    ]);
    expect(v.debt).toBe(som(120_000));
    // У архивного кнопки «Изменить ставку» нет.
    expect((await fees(owner, cpArchived)).canEditTariff).toBe(false);
  });

  it('правка первой ставки: сумма и правило первого месяца, долг пересчитан, отметка «изменена» и история', async () => {
    const before = await fees(chief, cp);
    const first = before.tariffs.find((x) => x.first)!;
    const res = await expectStatus(
      await edit(chief, cp, first.id, {
        amount: som(35_000),
        firstMonth: 'prorate',
        reason: '  ставку внесли с ошибкой ',
      }),
      200,
    );
    // Июль — пропорционально с 10-го: 35 000 × 22 / 31 = 24 839; август — октябрь по 35 000.
    expect(TariffEdited.parse(await res.json())).toEqual({
      changed: true,
      debtDelta: som(129_839 - 120_000),
    });
    const v = await fees(owner, cp);
    expect(v.debt).toBe(som(129_839));
    expect(v.contractor.firstMonth).toBe('prorate');
    expect(v.contractor.version).toBe(before.contractor.version + 1);
    expect(v.months.map((m) => m.charge)).toEqual([
      som(24_839),
      som(35_000),
      som(35_000),
      som(35_000),
    ]);
    const row = v.tariffs.find((x) => x.id === first.id)!;
    expect([row.amount, row.version, row.note, row.author]).toEqual([
      som(35_000),
      2,
      first.note,
      first.author,
    ]);
    expect(row.edited).toMatchObject({ by: 'chief-a', reason: 'ставку внесли с ошибкой' });
    expect(Number.isNaN(Date.parse(row.edited!.at))).toBe(false);
    expect(await lastHistory(cp)).toEqual({
      reason: 'ставку внесли с ошибкой',
      changes: [
        {
          field: 'tariffEdited',
          from: { amount: som(30_000), period: 'M', validFrom: '2026-07-01', firstMonth: 'full' },
          to: {
            amount: som(35_000),
            period: 'M',
            validFrom: '2026-07-01',
            firstMonth: 'prorate',
          },
        },
      ],
    });
  });

  it('правка без изменений ничего не пишет; устаревшая версия — «запись изменена»', async () => {
    const v = await fees(owner, cp);
    const first = v.tariffs.find((x) => x.first)!;
    const same = { amount: first.amount, firstMonth: 'prorate', version: first.version };
    const res = await expectStatus(await edit(owner, cp, first.id, same), 200);
    expect(TariffEdited.parse(await res.json())).toEqual({ changed: false, debtDelta: 0 });
    expect((await fees(owner, cp)).tariffs.find((x) => x.first)!.version).toBe(first.version);
    const stale = await expectStatus(
      await edit(owner, cp, first.id, { amount: som(1), version: first.version - 1 }),
      409,
    );
    expect((await failure(stale)).code).toBe('record_changed');
    expect((await fees(owner, cp)).tariffs.find((x) => x.first)!.amount).toBe(first.amount);
  });

  it('отказы: право, чужая организация, поля окна, разовый и архивный', async () => {
    const v = await fees(owner, cp);
    const first = v.tariffs.find((x) => x.first)!;
    const second = v.tariffs.find((x) => !x.first)!;
    const ok = { amount: first.amount, version: first.version };
    // Обычный бухгалтер платы не видит и журнал не меняет; чужая организация контрагента не находит.
    await expectStatus(await edit(acc, cp, first.id, { ...ok, amount: som(1) }), 403);
    await expectStatus(await edit(ownerB, cp, first.id, { ...ok, amount: som(1) }), 404);
    // Ставка другого контрагента — «не найдена».
    const other = (await fees(owner, cpFuture)).tariffs[0]!;
    const missing = await expectStatus(
      await edit(owner, cp, other.id, { ...ok, amount: som(1) }),
      404,
    );
    expect((await failure(missing)).code).toBe('tariff_not_found');
    // Причина обязательна, сумма не меньше нуля, лишних полей нет.
    await expectStatus(await edit(owner, cp, first.id, { ...ok, reason: '   ' }), 400);
    await expectStatus(await edit(owner, cp, first.id, { ...ok, amount: -1 }), 400);
    await expectStatus(await edit(owner, cp, first.id, { ...ok, note: 'x' }), 400);
    // Первая ставка — не раньше месяца начала обслуживания; месяц другой ставки занят.
    const early = await failure(
      await expectStatus(await edit(owner, cp, first.id, { ...ok, from: '2026-06' }), 400),
    );
    expect([early.code, early.details]).toEqual([
      'tariff_edit_before_start',
      { field: 'from', month: 'июль 2026' },
    ]);
    const taken = await failure(
      await expectStatus(await edit(owner, cp, first.id, { ...ok, from: '2026-11' }), 400),
    );
    expect(taken.code).toBe('tariff_edit_month_taken');
    // Правило первого месяца — только у первой ставки неполного месяца.
    const notFirst = await failure(
      await expectStatus(
        await edit(owner, cp, second.id, {
          amount: second.amount,
          from: second.from,
          firstMonth: 'next',
          version: second.version,
        }),
        400,
      ),
    );
    expect(notFirst.code).toBe('tariff_edit_first_month');
    // У разового платы нет, у архивного ставку не меняют.
    const oneOff = await expectStatus(await edit(owner, cpOne, other.id, ok), 409);
    expect((await failure(oneOff)).code).toBe('tariff_oneoff');
    const archived = (await fees(owner, cpArchived)).tariffs[0]!;
    const refused = await expectStatus(
      await edit(owner, cpArchived, archived.id, { amount: som(1), version: archived.version }),
      409,
    );
    expect((await failure(refused)).code).toBe('tariff_archived');
    // Ничего из отказанного не записано.
    const after = await fees(owner, cp);
    expect(after.tariffs.map((x) => [x.from, x.amount, x.version])).toEqual(
      v.tariffs.map((x) => [x.from, x.amount, x.version]),
    );
  });

  it('не первую ставку можно перенести на другой месяц и сделать годовой', async () => {
    const v = await fees(owner, cp);
    const second = v.tariffs.find((x) => !x.first)!;
    const res = await expectStatus(
      await edit(owner, cp, second.id, {
        amount: som(400_000),
        period: 'Y',
        from: '2026-12',
        reason: 'перепутали месяц',
        version: second.version,
      }),
      200,
    );
    // Ставка ещё не действует: долг не меняется.
    expect(TariffEdited.parse(await res.json())).toEqual({ changed: true, debtDelta: 0 });
    const row = (await fees(owner, cp)).tariffs.find((x) => x.id === second.id)!;
    expect([row.from, row.period, row.amount, row.version, row.deletable]).toEqual([
      '2026-12',
      'Y',
      som(400_000),
      second.version + 1,
      true,
    ]);
    expect((await lastHistory(cp))?.changes).toEqual([
      {
        field: 'tariffEdited',
        from: { amount: som(40_000), period: 'M', validFrom: '2026-11-01' },
        to: { amount: som(400_000), period: 'Y', validFrom: '2026-12-01' },
      },
    ]);
  });

  it('удаление: только ставка, которая ещё не действует, не единственная, с причиной', async () => {
    const v = await fees(owner, cp);
    const first = v.tariffs.find((x) => x.first)!;
    const second = v.tariffs.find((x) => !x.first)!;
    const started = await expectStatus(
      await remove(owner, cp, first.id, { version: first.version }),
      409,
    );
    expect((await failure(started)).code).toBe('tariff_delete_started');
    const only = (await fees(owner, cpFuture)).tariffs[0]!;
    expect(only.deletable).toBe(false);
    const last = await expectStatus(
      await remove(owner, cpFuture, only.id, { version: only.version }),
      409,
    );
    expect((await failure(last)).code).toBe('tariff_delete_last');
    const args = { version: second.version };
    await expectStatus(await remove(acc, cp, second.id, args), 403);
    await expectStatus(await remove(ownerB, cp, second.id, args), 404);
    await expectStatus(await remove(owner, cp, second.id, { ...args, reason: ' ' }), 400);
    const stale = await expectStatus(
      await remove(owner, cp, second.id, { version: second.version - 1 }),
      409,
    );
    expect((await failure(stale)).code).toBe('record_changed');
    await expectStatus(await remove(chief, cp, second.id, args), 200);
    const after = await fees(owner, cp);
    expect(after.tariffs.map((x) => x.id)).toEqual([first.id]);
    expect(after.debt).toBe(v.debt);
    expect(await lastHistory(cp)).toEqual({
      reason: 'внесли по ошибке',
      changes: [
        {
          field: 'tariffDeleted',
          from: { amount: som(400_000), period: 'Y', validFrom: '2026-12-01' },
        },
      ],
    });
    // Повторное удаление — ставки уже нет.
    await expectStatus(await remove(chief, cp, second.id, args), 404);
  });
});
