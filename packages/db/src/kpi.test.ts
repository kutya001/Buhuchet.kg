import { hashPassword } from '@buhuchet/adapters/password';
import { applyWho, UI_TEXTS, type ListQuery } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import { readHistory } from './history';
import {
  deleteIndicator,
  getIndicator,
  insertIndicator,
  kpiContractorOf,
  kpiContractorRecords,
  listIndicators,
  loadKpiData,
  loadMonths,
  loadTargets,
  lockFillMonth,
  reorderIndicators,
  resyncFillStatuses,
  saveIndicatorValues,
  setFillStatus,
  valueHistory,
  writeTargets,
  type IndicatorFields,
} from './kpi';
import { kpiMissingRows, kpiPeriodRows, listKpiPeriodPage, listKpiMissingPage } from './kpi-lists';
import { createOrganization, type CreatedOrganization } from './organizations';
import { indicatorMonths, indicators, indicatorTargets, indicatorValues } from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { readStatusHistory } from './status';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const TODAY = '2026-10-24';
const t = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key;
const query = (patch: Partial<ListQuery> = {}): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {}, ...patch }) as ListQuery;

const contractorFields = (patch: Partial<ContractorFields> = {}): ContractorFields => ({
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

const indicatorFields = (patch: Partial<IndicatorFields> = {}): IndicatorFields => ({
  name: 'Доля экспорта',
  unit: '%',
  type: 'pct',
  total: 'last',
  description: '',
  required: false,
  dueDay: 10,
  startMonth: '2026-01',
  scope: 'all',
  autoNew: true,
  ...patch,
});

describe.skipIf(!databaseAvailable())('Показатели контрагентов: данные', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let revenue = '';
  let staff = '';
  let cp1 = '';
  let cp2 = '';
  const ctxA = (): OrgContext => ({ orgId: a.orgId, userId: a.ownerUserId });
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, ctxA(), fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);

  /** Записать значения, как метод API: данные контрагентов, правила — домена. */
  const save = (
    writes: Parameters<typeof saveIndicatorValues>[3],
    reason: string | null = null,
  ) =>
    inA(async (tx) => {
      const ids = [...new Set(writes.map((w) => w.contractorId))];
      const list = await kpiContractorRecords(tx, { scope: undefined, ids });
      const data = await loadKpiData(tx, { contractorIds: ids });
      return saveIndicatorValues(
        tx,
        data,
        new Map(list.map((c) => [c.id, kpiContractorOf(c)])),
        writes,
        reason,
      );
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
      slug: 'kpi-a',
      owner: await owner('kpi-owner-a'),
      today: '2026-01-15',
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'kpi-b',
      owner: await owner('kpi-owner-b'),
      today: '2026-01-15',
    });
    [revenue, staff] = (await inA((tx) => listIndicators(tx))).map((i) => i.id) as [
      string,
      string,
    ];
    [cp1, cp2] = await inA(async (tx) => [
      await createContractor(tx, a.orgId, contractorFields(), null),
      await createContractor(
        tx,
        a.orgId,
        contractorFields({ name: 'ИП Асанов', inn: '21203199000123', regimeCode: null }),
        null,
      ),
    ]);
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('новой организации — два показателя-примера: «Выручка» (сумма) и «Количество сотрудников» (среднее)', async () => {
    const list = await inA((tx) => listIndicators(tx));
    expect(list.map((i) => [i.name, i.unit, i.type, i.total, i.required, i.startMonth, i.scope])).toEqual([
      ['Выручка', 'сом', 'som', 'sum', true, '2026-01', 'all'],
      ['Количество сотрудников', 'чел.', 'int', 'avg', true, '2026-01', 'all'],
    ]);
    const [history] = await inA((tx) => readHistory(tx, 'indicator', revenue));
    expect(history).toMatchObject({ action: 'create', changes: [{ field: 'name', to: 'Выручка' }] });
  });

  it('п. 22: три месяца «Выручки» — сумма, среднее, максимум, минимум в «За период»', async () => {
    await save([
      { contractorId: cp1, indicatorId: revenue, month: '2026-07', value: 10_000_000 },
      { contractorId: cp1, indicatorId: revenue, month: '2026-08', value: 15_000_000 },
      { contractorId: cp1, indicatorId: revenue, month: '2026-09', value: 20_000_000 },
    ]);
    const { rows } = await inA((tx) =>
      kpiPeriodRows(tx, { scope: undefined, from: '2026-07', to: '2026-09', today: TODAY }),
    );
    const row = rows.find((r) => r.contractorId === cp1 && r.indicatorId === revenue)!;
    expect(row.totals).toEqual({ sum: 45_000_000, avg: 15_000_000, max: 20_000_000, min: 10_000_000 });
    expect(row.count).toBe(3);
  });

  it('месяц «Заполнено», когда внесены все обязательные; 0 — внесено; стёртое — снова «Не заполнено»', async () => {
    const statusOf = async (month: string) =>
      (await inA((tx) => loadMonths(tx, { contractorIds: [cp1], from: month, to: month })))[0]
        ?.status ?? 'empty';
    expect(await statusOf('2026-07')).toBe('empty');
    const { statuses } = await save([
      { contractorId: cp1, indicatorId: staff, month: '2026-07', value: 0 },
    ]);
    expect(statuses).toEqual([{ contractorId: cp1, month: '2026-07', from: 'empty', to: 'filled' }]);
    expect(await statusOf('2026-07')).toBe('filled');
    // Без изменений ничего не пишется.
    expect((await save([{ contractorId: cp1, indicatorId: staff, month: '2026-07', value: 0 }])).changed).toEqual([]);
    await save([{ contractorId: cp1, indicatorId: staff, month: '2026-07', value: null }]);
    expect(await statusOf('2026-07')).toBe('empty');
  });

  it('«Проверено»: правка значения возвращает месяц на «Заполнено» с пометкой в «Истории статусов»', async () => {
    await save([{ contractorId: cp1, indicatorId: staff, month: '2026-08', value: 3_700 }]);
    const checked = await inA(async (tx) => {
      const row = (await lockFillMonth(tx, cp1, '2026-08'))!;
      expect(row.status).toBe('filled');
      return setFillStatus(tx, row, 'checked', { version: row.version });
    });
    expect(checked.status).toBe('checked');
    await save([{ contractorId: cp1, indicatorId: staff, month: '2026-08', value: 3_800, note: 'по штатке' }]);
    const history = await inA((tx) => readStatusHistory(tx, 'indicator', checked.id));
    expect(history.map((h) => [h.from, h.to, h.reason])).toEqual([
      ['empty', 'filled', null],
      ['filled', 'checked', null],
      ['checked', 'filled', 'Значение изменено — нужна повторная проверка'],
    ]);
    // Устаревшая версия — «изменено другим пользователем».
    await expect(
      inA(async (tx) => setFillStatus(tx, (await lockFillMonth(tx, cp1, '2026-08'))!, 'checked', { version: checked.version })),
    ).rejects.toMatchObject({ code: 'record_changed' });
  });

  it('история значения: было → стало, кто; пометка «Из Excel»', async () => {
    await save([{ contractorId: cp1, indicatorId: staff, month: '2026-08', value: 3_900 }], 'Из Excel');
    const items = await inA((tx) => valueHistory(tx, cp1, '2026-08'));
    expect(items.map((x) => [x.indicatorId, x.from, x.to, x.reason, x.actor])).toEqual([
      [staff, 3_800, 3_900, 'Из Excel', 'Организации В.'],
      [staff, 3_700, 3_800, null, 'Организации В.'],
      [staff, null, 3_700, null, 'Организации В.'],
      [revenue, null, 15_000_000, null, 'Организации В.'],
    ]);
    const [row] = await inA((tx) =>
      tx.select().from(indicatorValues).where(eq(indicatorValues.month, '2026-08')).limit(1),
    );
    const log = await inA((tx) => readHistory(tx, 'indicator_value', row!.id));
    expect(log[0]).toMatchObject({ contractorId: cp1, action: 'create' });
  });

  it('«Кому вести»: «Выбранным» — история показателя у контрагента; пересчёт статусов месяцев', async () => {
    const id = await inA((tx) => insertIndicator(tx, indicatorFields({ required: true })));
    await inA(async (tx) => {
      const changes = applyWho(null, 'selected', new Set([cp1]), [{ id: cp1 }, { id: cp2 }], () => undefined, TODAY);
      await writeTargets(tx, id, changes);
      await resyncFillStatuses(tx, TODAY);
    });
    const targets = await inA((tx) => loadTargets(tx));
    expect(targets.get(`${id}|${cp1}`)).toEqual({ on: true, from: null, offSince: null });
    expect(targets.get(`${id}|${cp2}`)).toEqual({ on: false, from: null, offSince: null });
    // Новый обязательный показатель: месяцы cp1 больше не заполнены.
    const months = await inA((tx) => loadMonths(tx, { contractorIds: [cp1], from: '2026-08', to: '2026-08' }));
    expect(months[0]?.status).toBe('empty');
    // Выключение у контрагента — в историю показателя с контрагентом.
    await inA(async (tx) => {
      const prev = (await getIndicator(tx, id))!;
      const changes = applyWho(prev, 'selected', new Set(), [{ id: cp1 }], (c) => targets.get(`${id}|${c}`), TODAY);
      await writeTargets(tx, id, changes);
    });
    const log = await inA((tx) => readHistory(tx, 'indicator', id));
    expect(log.at(-1)).toMatchObject({
      contractorId: cp1,
      changes: [{ field: 'enabled', from: true, to: false }],
    });
    await inA((tx) => tx.update(indicators).set({ archived: true }).where(eq(indicators.id, id)));
    await inA((tx) => resyncFillStatuses(tx, TODAY));
  });

  it('порядок показателей и удаление только без значений', async () => {
    const list = await inA((tx) => listIndicators(tx));
    const ids = list.map((i) => i.id).reverse();
    expect(await inA((tx) => reorderIndicators(tx, ids))).toBe(true);
    expect((await inA((tx) => listIndicators(tx))).map((i) => i.id)).toEqual(ids);
    expect(await inA((tx) => reorderIndicators(tx, ids.slice(1)))).toBe(false);
    const fresh = await inA((tx) => insertIndicator(tx, indicatorFields({ name: 'Площадь', unit: 'м²', type: 'dec' })));
    const row = (await inA((tx) => getIndicator(tx, fresh)))!;
    expect(row).toMatchObject({ valueCount: 0, hasRows: false, sortOrder: list.length + 1 });
    await inA((tx) => deleteIndicator(tx, row));
    expect(await inA((tx) => getIndicator(tx, fresh))).toBeNull();
    // Показатель со значениями не удаляется — держит и внешний ключ.
    const withValues = (await inA((tx) => getIndicator(tx, revenue)))!;
    expect(withValues.hasRows).toBe(true);
    await expect(inA((tx) => deleteIndicator(tx, withValues))).rejects.toThrow();
  });

  it('п. 23 и 63: «Не заполнено» — с «с <месяц>» до прошлого месяца; пустой месяц не ноль', async () => {
    const rows = await inA((tx) => kpiMissingRows(tx, { scope: undefined, today: TODAY }));
    const months = rows.filter((r) => r.contractorId === cp2).map((r) => r.month);
    expect(months[0]).toBe('2026-01');
    expect(months.at(-1)).toBe('2026-09');
    const page = await inA((tx) => listKpiMissingPage(tx, query(), rows, t));
    expect(page.total).toBe(rows.length);
    expect(page.rows[0]!.due).toBe('2026-02-10');
    const period = await inA((tx) =>
      kpiPeriodRows(tx, { scope: undefined, from: '2026-07', to: '2026-10', today: TODAY }),
    );
    const staffRow = period.rows.find((r) => r.contractorId === cp1 && r.indicatorId === staff)!;
    expect(staffRow.values).toEqual([null, 3_900, null, null]);
    expect(staffRow.empty).toEqual([true, false, true, false]);
    const list = await inA((tx) => listKpiPeriodPage(tx, query({ search: { q: 'Асанов', keys: [] } }), { ...period, t }));
    expect(list.rows.every((r) => r.contractorName === 'ИП Асанов')).toBe(true);
  });

  it('чужая организация не видна, а строку с чужой организацией не вставить', async () => {
    expect(await inB((tx) => getIndicator(tx, revenue))).toBeNull();
    expect((await inB((tx) => listIndicators(tx))).map((i) => i.name)).toEqual([
      'Выручка',
      'Количество сотрудников',
    ]);
    expect(await inB((tx) => loadMonths(tx))).toEqual([]);
    expect((await inB((tx) => loadTargets(tx))).size).toBe(0);
    expect(await inB((tx) => tx.select().from(indicatorValues))).toEqual([]);
    await inB((tx) => tx.delete(indicatorValues));
    expect((await inA((tx) => tx.select().from(indicatorValues))).length).toBeGreaterThan(0);
    await expect(
      inB((tx) =>
        tx.insert(indicatorTargets).values({
          orgId: a.orgId,
          indicatorId: revenue,
          contractorId: cp1,
          enabled: false,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      inB((tx) =>
        tx.insert(indicatorMonths).values({ orgId: a.orgId, contractorId: cp1, month: '2026-01' }),
      ),
    ).rejects.toThrow();
    // Без контекста организации не видно ничего.
    const none = await db.app.db.transaction((tx) => tx.execute(sql`select count(*)::int as n from indicators`));
    expect(none[0]).toEqual({ n: 0 });
  });
});
