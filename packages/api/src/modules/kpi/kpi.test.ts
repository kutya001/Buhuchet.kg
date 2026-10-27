import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  IndicatorCard,
  Indicators,
  KpiCard,
  KpiEntry,
  KpiMissingSummary,
  KpiMonth,
  KpiValuesSaved,
  KpiWho,
  MonthStatus,
} from '@buhuchet/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { fixedClock } from '@buhuchet/adapters';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  signIn,
  TEST_PASSWORD,
} from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const C1 = '00000000-0000-4000-8000-0000000000a1';
const C2 = '00000000-0000-4000-8000-0000000000a2';
const C3 = '00000000-0000-4000-8000-0000000000a3';
const B1 = '00000000-0000-4000-8000-0000000000b1';

/** Сотые: 1 250 000 сом → 125000000. */
const som = (n: number) => n * 100;

describe.skipIf(!databaseAvailable())('Показатели контрагентов', () => {
  let f: Fixture;
  let app: ReturnType<typeof createApp>;
  let owner: string;
  let ownerB: string;
  let chief: string;
  let acc: string;
  let senior: string;
  let admin: string;
  let revenue: string;
  let staffCount: string;

  const call = (
    cookie: string | undefined,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ) => apiRequest(app, method, path, cookie, body);
  const errorOf = async (res: Response) =>
    ((await res.json()) as { error: { code: string; details?: unknown } }).error;
  const indicators = async (cookie = owner) =>
    Indicators.parse(await (await call(cookie, 'GET', '/api/kpi/indicators')).json());
  const summary = async (cookie = owner) =>
    KpiMissingSummary.parse(await (await call(cookie, 'GET', '/api/kpi/missing-summary')).json());
  const month = async (m: string, cookie = owner) =>
    KpiMonth.parse(await (await call(cookie, 'GET', `/api/kpi/month?month=${m}`)).json());
  const entry = async (contractorId: string, m: string, cookie = owner) =>
    KpiEntry.parse(
      await (
        await call(cookie, 'GET', `/api/kpi/entry?contractorId=${contractorId}&month=${m}`)
      ).json(),
    );
  const put = (
    cookie: string,
    values: {
      contractorId: string;
      indicatorId: string;
      month: string;
      value: number | null;
      note?: string;
      prev?: number | null;
    }[],
  ) => call(cookie, 'PUT', '/api/kpi/values', { values });
  const features = (orgId: string, on: Record<string, boolean>) =>
    f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: sql`${schema.orgSettings.features} || ${JSON.stringify(on)}::jsonb` })
      .where(eq(schema.orgSettings.orgId, orgId));
  const contractor = (
    id: string,
    orgId: string,
    name: string,
    inn: string,
    regimeCode: string,
  ) => ({
    id,
    orgId,
    name,
    inn,
    phone: '+996505890076',
    formCode: 'ФС-01',
    regimeCode,
    startDate: '2024-07-16',
  });

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    // 24.10.2026 09:00 по Бишкеку: текущий месяц заполнения — 09.2026, срок — 10.10.2026 прошёл.
    app = createApp(createTestDeps({ db: f.t.app.db, clock: fixedClock('2026-10-24T03:00:00Z') }));
    await features(f.a.orgId, { indicators: true, files: true });
    await f.t.admin.db.insert(schema.contractors).values([
      {
        ...contractor(C1, f.a.orgId, 'ОсОО «Укс»', '03744097401851', 'РЕЖ-01'),
        responsibleEmployeeId: f.people['acc-a']!.employeeId,
      },
      contractor(C2, f.a.orgId, 'ИП Асанов', '21503199000123', 'РЕЖ-03'),
      contractor(B1, f.b.orgId, 'ОсОО «Бета»', '03744097401852', 'РЕЖ-01'),
    ]);
    // Показатели-примеры создаются месяцем регистрации; для проверки — «Вести с 01.2026», и обязательна
    // только «Выручка».
    await f.t.admin.db.update(schema.indicators).set({ startMonth: '2026-01' });
    await f.t.admin.db
      .update(schema.indicators)
      .set({ required: false })
      .where(eq(schema.indicators.name, 'Количество сотрудников'));
    [owner, ownerB, chief, acc, senior, admin] = await Promise.all([
      signIn(app, 'owner-a', TEST_PASSWORD),
      signIn(app, 'owner-b', TEST_PASSWORD),
      signIn(app, 'chief-a', TEST_PASSWORD),
      signIn(app, 'acc-a', TEST_PASSWORD),
      signIn(app, 'senior-a', TEST_PASSWORD),
      signIn(app, 'platform-admin', TEST_PASSWORD),
    ]);
    const list = await indicators();
    revenue = list.items.find((i) => i.name === 'Выручка')!.id;
    staffCount = list.items.find((i) => i.name === 'Количество сотрудников')!.id;
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('без входа — 401, администратор платформы — 403, функция выключена — 403 indicators_off', async () => {
    expect((await call(undefined, 'GET', '/api/kpi/indicators')).status).toBe(401);
    expect((await call(admin, 'GET', '/api/kpi/indicators')).status).toBe(403);
    const off = await call(ownerB, 'GET', '/api/kpi/month');
    expect(off.status).toBe(403);
    expect((await errorOf(off)).code).toBe('indicators_off');
    // У «Старшего» нет «Просматривать показатели».
    expect((await call(senior, 'GET', '/api/kpi/month')).status).toBe(403);
  });

  it('два показателя-примера; окно показателя проверяет название, создаёт — право «Настраивать показатели»', async () => {
    const list = await indicators();
    expect(list.items.map((i) => [i.name, i.unit, i.type, i.total])).toEqual([
      ['Выручка', 'сом', 'som', 'sum'],
      ['Количество сотрудников', 'чел.', 'int', 'avg'],
    ]);
    expect(list.contractors).toBe(2);
    expect(list.items[0]!.on).toBe(2);
    const body = {
      name: 'Доля экспорта',
      unit: '%',
      type: 'pct',
      total: 'last',
      description: '',
      required: false,
      dueDay: 10,
      start: '2026-10',
      scope: 'all',
      autoNew: true,
      selected: [],
    };
    expect((await call(acc, 'POST', '/api/kpi/indicators', body)).status).toBe(403);
    const taken = await call(chief, 'POST', '/api/kpi/indicators', { ...body, name: ' выручка ' });
    expect(taken.status).toBe(400);
    expect(await errorOf(taken)).toMatchObject({ code: 'name_taken', details: { field: 'name' } });
    const future = await call(chief, 'POST', '/api/kpi/indicators', { ...body, start: '2026-11' });
    expect((await errorOf(future)).code).toBe('start_in_future');
    const none = await call(chief, 'POST', '/api/kpi/indicators', { ...body, scope: 'selected' });
    expect((await errorOf(none)).code).toBe('targets_required');
    const res = await call(chief, 'POST', '/api/kpi/indicators', body);
    expect(res.status).toBe(200);
    expect(Indicators.parse(await res.json()).items.map((i) => i.name)).toContain('Доля экспорта');
  });

  it('(п. 63) «Выручка» ведётся с 01.2026, внесены 08 и 09: счётчик красный, значок у контрагента; внесли 03 — незаполненных меньше', async () => {
    const saved = await put(owner, [
      { contractorId: C1, indicatorId: revenue, month: '2026-08', value: som(500_000) },
      { contractorId: C1, indicatorId: revenue, month: '2026-09', value: som(600_000) },
    ]);
    expect(saved.status).toBe(200);
    expect(KpiValuesSaved.parse(await saved.json()).changed).toBe(2);
    const s = await summary();
    expect(s.overdue).toBe(true);
    const c1 = s.contractors.find((x) => x.contractorId === C1)!;
    expect(c1.months).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    // Бухгалтер видит только своих контрагентов.
    expect((await summary(acc)).contractors.map((x) => x.contractorId)).toEqual([C1]);

    const march = await month('2026-03');
    expect(march.choices.find((x) => x.month === '2026-03')!.missing).toBe(2);
    const row = march.rows.find((r) => r.contractorId === C1)!;
    expect(row.cells.find((x) => x.indicatorId === revenue)!.state).toBe('required');
    expect(
      (
        await put(acc, [
          { contractorId: C1, indicatorId: revenue, month: '2026-03', value: som(1) },
        ])
      ).status,
    ).toBe(200);
    expect((await summary()).contractors.find((x) => x.contractorId === C1)!.months).toHaveLength(
      6,
    );
    expect(
      (await month('2025-12')).rows
        .find((r) => r.contractorId === C1)!
        .cells.find((x) => x.indicatorId === revenue)!.state,
    ).toBe('early');
  });

  it('(п. 22, п. 23) итоги карточки — только по заполненным месяцам; пустой месяц — не ноль', async () => {
    await put(owner, [
      { contractorId: C2, indicatorId: revenue, month: '2026-04', value: som(100_000) },
      { contractorId: C2, indicatorId: revenue, month: '2026-05', value: som(150_000) },
      { contractorId: C2, indicatorId: revenue, month: '2026-06', value: som(200_000) },
    ]);
    const q = await call(owner, 'GET', `/api/kpi/contractors/${C2}?from=2026-04&to=2026-06`);
    expect(q.status).toBe(200);
    const card = KpiCard.parse(await q.json());
    const r = card.rows.find((x) => x.indicator.id === revenue)!;
    expect(r.totals).toEqual({
      sum: som(450_000),
      avg: som(150_000),
      max: som(200_000),
      min: som(100_000),
      last: som(200_000),
    });
    const gap = KpiCard.parse(
      await (await call(owner, 'GET', `/api/kpi/contractors/${C2}?from=2026-06&to=2026-07`)).json(),
    );
    const g = gap.rows.find((x) => x.indicator.id === revenue)!;
    expect(g.totals.avg).toBe(som(200_000));
    expect([g.count, g.need]).toEqual([1, 2]);
    expect(gap.missing!.months).toContain('2026-07');
    expect(gap.past.find((p) => p.month === '2026-07')).toBeDefined();
  });

  it('пусто и 0 — разное; целое число без копеек; ячейки и месяцы проверяются', async () => {
    const zero = await put(owner, [
      { contractorId: C2, indicatorId: revenue, month: '2026-07', value: 0 },
    ]);
    expect(zero.status).toBe(200);
    expect((await summary()).contractors.find((x) => x.contractorId === C2)!.months).not.toContain(
      '2026-07',
    );
    const frac = await put(owner, [
      { contractorId: C2, indicatorId: staffCount, month: '2026-07', value: 1250 },
    ]);
    expect((await errorOf(frac)).code).toBe('value_invalid');
    const future = await put(owner, [
      { contractorId: C2, indicatorId: revenue, month: '2026-11', value: 1 },
    ]);
    expect((await errorOf(future)).code).toBe('month_in_future');
    // Бухгалтер вносит только своим контрагентам.
    expect(
      (await put(acc, [{ contractorId: C2, indicatorId: revenue, month: '2026-07', value: 1 }]))
        .status,
    ).toBe(404);
  });

  it('(п. 44) «Выбранным» — только ОНР: у контрагента на ЕН ячейка серая, в «Не заполнено» его нет; новый на ОНР — включён сам', async () => {
    const card = IndicatorCard.parse(
      await (await call(chief, 'GET', `/api/kpi/indicators/${revenue}`)).json(),
    );
    const {
      id: _id,
      archived: _a,
      order: _o,
      version,
      valueCount: _v,
      hasRows: _h,
      on: _n,
      selected: _s,
      history: _hs,
      ...fields
    } = card;
    const res = await call(chief, 'PUT', `/api/kpi/indicators/${revenue}`, {
      ...fields,
      scope: 'selected',
      autoNew: true,
      selected: [C1],
      version,
    });
    expect(res.status).toBe(200);
    const sep = await month('2026-09');
    const en = sep.rows.find((r) => r.contractorId === C2)!;
    expect(en.cells.find((x) => x.indicatorId === revenue)!.state).toBe('off');
    expect((await summary()).contractors.map((x) => x.contractorId)).not.toContain(C2);
    const off = await put(owner, [
      { contractorId: C2, indicatorId: revenue, month: '2026-08', value: 1 },
    ]);
    expect((await errorOf(off)).code).toBe('cell_off');
    await f.t.admin.db.insert(schema.contractors).values({
      ...contractor(C3, f.a.orgId, 'ОсОО «Новый»', '03744097401853', 'РЕЖ-01'),
      startDate: '2026-08-01',
    });
    const who = KpiWho.parse(await (await call(owner, 'GET', '/api/kpi/who')).json());
    expect(
      who.contractors.find((x) => x.id === C3)!.cells.find((x) => x.indicatorId === revenue)!.on,
    ).toBe(true);
    expect(
      (await month('2026-09')).rows
        .find((r) => r.contractorId === C3)!
        .cells.find((x) => x.indicatorId === revenue)!.state,
    ).toBe('required');
    const history = IndicatorCard.parse(
      await (await call(chief, 'GET', `/api/kpi/indicators/${revenue}`)).json(),
    ).history;
    expect(
      history.some(
        (h) => h.contractor === 'ИП Асанов' && h.changes.some((c) => c.field === 'enabled'),
      ),
    ).toBe(true);
  });

  it('статус месяца: «Заполнено» само, «Проверено» — право «Проверять показатели», правка возвращает «Заполнено», откат — с причиной', async () => {
    const e = await entry(C1, '2026-09', chief);
    expect(e.status!.code).toBe('filled');
    expect(e.canCheck).toBe(true);
    expect((await entry(C1, '2026-09', acc)).canCheck).toBe(false);
    const body = { contractorId: C1, month: '2026-09', version: e.status!.version };
    expect((await call(acc, 'POST', '/api/kpi/months/check', body)).status).toBe(403);
    const checked = await call(chief, 'POST', '/api/kpi/months/check', body);
    expect(checked.status).toBe(200);
    const st = MonthStatus.parse(await checked.json());
    expect(st.code).toBe('checked');
    expect((await call(chief, 'POST', '/api/kpi/months/check', body)).status).toBe(409);

    const edit = KpiValuesSaved.parse(
      await (
        await put(acc, [
          { contractorId: C1, indicatorId: revenue, month: '2026-09', value: som(610_000) },
        ])
      ).json(),
    );
    expect(edit.statuses).toEqual([{ contractorId: C1, month: '2026-09', status: 'filled' }]);
    const after = await entry(C1, '2026-09');
    expect(after.statusHistory.at(-1)).toMatchObject({
      from: 'checked',
      to: 'filled',
      reason: 'Значение изменено — нужна повторная проверка',
    });
    expect(after.history[0]).toMatchObject({
      from: som(600_000),
      to: som(610_000),
      actor: 'acc-a',
    });

    const again = MonthStatus.parse(
      await (
        await call(chief, 'POST', '/api/kpi/months/check', {
          ...body,
          version: after.status!.version,
        })
      ).json(),
    );
    const back = { contractorId: C1, month: '2026-09', version: again.version, to: 'filled' };
    expect(
      (await call(owner, 'POST', '/api/kpi/months/rollback', { ...back, reason: ' ' })).status,
    ).toBe(400);
    expect(
      (
        await call(owner, 'POST', '/api/kpi/months/rollback', {
          ...back,
          to: 'empty',
          reason: 'Ошибка',
        })
      ).status,
    ).toBe(400);
    const rolled = await call(owner, 'POST', '/api/kpi/months/rollback', {
      ...back,
      reason: 'Ошибка в выписке',
    });
    expect(rolled.status).toBe(200);
    expect(MonthStatus.parse(await rolled.json()).code).toBe('filled');
    expect((await entry(C1, '2026-09')).statusHistory.at(-1)).toMatchObject({
      rollback: true,
      reason: 'Ошибка в выписке',
    });
  });

  it('«Кому вести»: галочка — право «Настраивать показатели», «Не ведётся с …», «с <месяц>» у контрагента', async () => {
    const share = (await indicators()).items.find((i) => i.name === 'Доля экспорта')!.id;
    const off = { changes: [{ indicatorId: share, contractorId: C1, on: false }] };
    expect((await call(acc, 'PUT', '/api/kpi/who', off)).status).toBe(403);
    expect(await (await call(chief, 'PUT', '/api/kpi/who', off)).json()).toEqual({ changed: 1 });
    expect(await (await call(chief, 'PUT', '/api/kpi/who', off)).json()).toEqual({ changed: 0 });
    const who = KpiWho.parse(await (await call(acc, 'GET', '/api/kpi/who')).json());
    expect(who.contractors.map((c) => c.id)).toEqual([C1]);
    expect(who.contractors[0]!.cells.find((x) => x.indicatorId === share)).toMatchObject({
      on: false,
      offSince: '2026-10',
    });
    const from = { indicatorId: revenue, contractorId: C1, from: '2026-03' };
    expect(await (await call(chief, 'PUT', '/api/kpi/who/from', from)).json()).toEqual({
      changed: 1,
    });
    expect((await summary()).contractors.find((x) => x.contractorId === C1)!.months).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    const late = await call(chief, 'PUT', '/api/kpi/who/from', { ...from, from: '2026-11' });
    expect((await errorOf(late)).code).toBe('from_in_future');
    const notOn = await call(chief, 'PUT', '/api/kpi/who/from', { ...from, indicatorId: share });
    expect((await errorOf(notOn)).code).toBe('target_off');
  });

  it('порядок, архив и удаление: показатель со значениями — только в архив', async () => {
    const list = (await indicators()).items;
    const has = await call(
      chief,
      'DELETE',
      `/api/kpi/indicators/${revenue}?version=${list[0]!.version}`,
    );
    expect(has.status).toBe(409);
    expect((await errorOf(has)).code).toBe('indicator_has_values');
    const share = list.find((i) => i.name === 'Доля экспорта')!;
    expect(
      (await call(chief, 'DELETE', `/api/kpi/indicators/${share.id}?version=${share.version}`))
        .status,
    ).toBe(200);
    const staff = list.find((i) => i.id === staffCount)!;
    const arch = await call(chief, 'POST', `/api/kpi/indicators/${staffCount}/archive`, {
      archived: true,
      version: staff.version,
    });
    expect(
      Indicators.parse(await arch.json()).items.find((i) => i.id === staffCount)!.archived,
    ).toBe(true);
    const archived = await put(owner, [
      { contractorId: C1, indicatorId: staffCount, month: '2026-09', value: som(5) },
    ]);
    expect((await errorOf(archived)).code).toBe('indicator_archived');
    const order = await call(chief, 'PUT', '/api/kpi/indicators-order', {
      ids: [staffCount, revenue],
    });
    expect(Indicators.parse(await order.json()).items.map((i) => i.id)).toEqual([
      staffCount,
      revenue,
    ]);
    expect((await call(chief, 'PUT', '/api/kpi/indicators-order', { ids: [revenue] })).status).toBe(
      409,
    );
  });

  it('«За период» и «Не заполнено»: страница, значения столбца, выгрузка', async () => {
    const period = await call(owner, 'GET', '/api/kpi/period?from=2026-01&to=2026-09');
    expect(period.status).toBe(200);
    const page = (await period.json()) as {
      items: { contractorId: string; indicatorId: string; values: (number | null)[] }[];
    };
    const c1 = page.items.find((r) => r.contractorId === C1 && r.indicatorId === revenue)!;
    expect(c1.values.slice(7)).toEqual([som(500_000), som(610_000)]);
    expect((await call(owner, 'GET', '/api/kpi/period?from=2020-01&to=2026-09')).status).toBe(400);
    const values = await call(
      owner,
      'GET',
      '/api/kpi/period/values?from=2026-01&to=2026-09&col=ind',
    );
    expect(values.status).toBe(200);
    const missing = (await (await call(owner, 'GET', '/api/kpi/missing')).json()) as {
      items: { due: string }[];
    };
    const dues = missing.items.map((r) => r.due);
    expect(dues).toEqual([...dues].sort());
    const xlsx = await call(owner, 'GET', '/api/kpi/missing/export?cols=cp,m,miss,due');
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml');
    expect((await call(acc, 'GET', '/api/kpi/missing/export?cols=cp')).status).toBe(200);
  });

  it('файлы значения: видит тот, кому видно значение; чужая организация — 404', async () => {
    const valueId = (await entry(C1, '2026-09')).items.find(
      (i) => i.indicator.id === revenue,
    )!.valueId!;
    expect((await call(owner, 'GET', `/api/files?kind=indicator_value&id=${valueId}`)).status).toBe(
      200,
    );
    expect((await call(acc, 'GET', `/api/files?kind=indicator_value&id=${valueId}`)).status).toBe(
      200,
    );
    expect(
      (await call(ownerB, 'GET', `/api/files?kind=indicator_value&id=${valueId}`)).status,
    ).toBe(404);
    const c2value = (await entry(C2, '2026-04')).items.find(
      (i) => i.indicator.id === revenue,
    )!.valueId!;
    expect((await call(acc, 'GET', `/api/files?kind=indicator_value&id=${c2value}`)).status).toBe(
      404,
    );
  });

  it('чужая организация не видна: показатели, значения, контрагенты', async () => {
    await features(f.b.orgId, { indicators: true });
    const list = await indicators(ownerB);
    expect(list.items.map((i) => i.name)).toEqual(['Выручка', 'Количество сотрудников']);
    expect(list.items.map((i) => i.id)).not.toContain(revenue);
    expect((await call(ownerB, 'GET', `/api/kpi/indicators/${revenue}`)).status).toBe(404);
    expect(
      (await call(ownerB, 'GET', `/api/kpi/entry?contractorId=${C1}&month=2026-09`)).status,
    ).toBe(404);
    expect((await call(ownerB, 'GET', `/api/kpi/contractors/${C1}`)).status).toBe(404);
    expect(
      (await put(ownerB, [{ contractorId: C1, indicatorId: revenue, month: '2026-09', value: 1 }]))
        .status,
    ).toBe(404);
    const own = list.items[0]!.id;
    expect(
      (await put(ownerB, [{ contractorId: C1, indicatorId: own, month: '2026-09', value: 1 }]))
        .status,
    ).toBe(404);
    expect((await month('2026-09', ownerB)).rows.map((r) => r.contractorId)).toEqual([B1]);
  });

  it('область «Свои»: контрагент не своего бухгалтера не виден в окне значения, карточке и списках', async () => {
    expect((await call(acc, 'GET', `/api/kpi/entry?contractorId=${C2}&month=2026-09`)).status).toBe(
      404,
    );
    expect((await call(acc, 'GET', `/api/kpi/contractors/${C2}`)).status).toBe(404);
    for (const path of [
      '/api/kpi/period?from=2026-01&to=2026-09&size=all',
      '/api/kpi/missing?size=all',
    ]) {
      const res = await call(acc, 'GET', path);
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as { items: { contractorId: string }[] };
      expect(new Set(items.map((r) => r.contractorId))).toEqual(new Set([C1]));
    }
    // Число значений показателя — по всей организации: его видит только тот, кто настраивает показатели.
    expect((await indicators(acc)).items.every((i) => i.valueCount === 0 && !i.hasRows)).toBe(true);
    expect(
      (await indicators(chief)).items.find((i) => i.id === revenue)!.valueCount,
    ).toBeGreaterThan(0);
  });

  it('одновременная правка: значение уже изменил другой — 409 «Запись изменена другим пользователем», ничего не записано', async () => {
    const valueOf = async () =>
      (await entry(C1, '2026-09')).items.find((i) => i.indicator.id === revenue)!.value;
    const cell = { contractorId: C1, indicatorId: revenue, month: '2026-09' };
    const seen = await valueOf();
    expect((await put(chief, [{ ...cell, value: som(700_000), prev: seen }])).status).toBe(200);
    const late = await put(acc, [{ ...cell, value: som(650_000), prev: seen }]);
    expect(late.status).toBe(409);
    expect((await errorOf(late)).code).toBe('record_changed');
    expect(await valueOf()).toBe(som(700_000));
    // Перечитал — сохраняется.
    expect((await put(acc, [{ ...cell, value: som(650_000), prev: som(700_000) }])).status).toBe(
      200,
    );
    expect(await valueOf()).toBe(som(650_000));
  });
});
