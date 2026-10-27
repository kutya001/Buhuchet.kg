import { RecordChangedError, UI_TEXTS, type ListQuery } from '@buhuchet/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import {
  createOrgReportType,
  enabledReportTypeCount,
  exportOrgReportTypes,
  getOrgReportTypeSetting,
  listOrgReportTypeSettings,
  listOrgReportTypesPage,
  listOrgReportTypeValues,
  updateOrgReportType,
} from './dicts';
import { readHistory } from './history';
import { gkedItems, organizations, orgReportTypes, platformReference, reportTypes } from './schema';
import { readSpecJson } from './spec-data';
import { listTaxes, taxGkedNames } from './taxes';
import {
  createTestDatabase,
  databaseAvailable,
  seedPlatformDictionaries,
  type TestDatabase,
} from './testing';

const ORG_A = '0c3e5f70-0000-4000-8000-00000000000a';
const ORG_B = '0c3e5f70-0000-4000-8000-00000000000b';

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});
const violates = (constraint: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ constraint_name: constraint }) });

const t = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key;
const query = (patch: Partial<ListQuery> = {}): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {}, ...patch }) as ListQuery;
const defaults = { enabled: true, remindDays: [7, 3], needFile: false, needReceipt: false };

describe.skipIf(!databaseAvailable())('Справочники: виды отчётов организации', () => {
  let db: TestDatabase;
  const inOrg = <T>(orgId: string, fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId }, fn);
  let activeTypes = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedPlatformDictionaries(db.admin.db);
    await db.admin.db.insert(organizations).values([
      { id: ORG_A, slug: 'dicts-a', name: 'Организация А' },
      { id: ORG_B, slug: 'dicts-b', name: 'Организация Б' },
    ]);
    activeTypes = (await db.admin.db.select().from(reportTypes).where(eq(reportTypes.active, true)))
      .length;
    await inOrg(ORG_A, async (tx) => {
      await createOrgReportType(tx, 'nds', { ...defaults, remindDays: [14, 3] });
      await createOrgReportType(tx, 'soc', { ...defaults, needReceipt: true });
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('чужая организация не видна, не меняется и не создаётся', async () => {
    expect(await inOrg(ORG_B, (tx) => listOrgReportTypeSettings(tx))).toEqual([]);
    expect(await inOrg(ORG_B, (tx) => getOrgReportTypeSetting(tx, 'nds'))).toBeNull();
    expect(await inOrg(ORG_B, (tx) => enabledReportTypeCount(tx))).toBe(0);
    const page = await inOrg(ORG_B, (tx) => listOrgReportTypesPage(tx, query(), t));
    expect(page.rows.find((r) => r.code === 'nds')).toMatchObject({
      enabled: false,
      version: null,
      remindDays: null,
    });
    // Строку чужой организации нельзя изменить: для своей её нет.
    await expect(
      inOrg(ORG_B, (tx) => updateOrgReportType(tx, 'nds', 1, { enabled: false })),
    ).rejects.toThrow(/не найдена|not found/i);
    const [row] = await db.admin.db
      .select()
      .from(orgReportTypes)
      .where(eq(orgReportTypes.orgId, ORG_A));
    expect(row?.enabled).toBe(true);
    // Строку для чужой организации не вставить: политика проверяет org_id новой строки.
    await expect(
      inOrg(ORG_B, (tx) =>
        tx.insert(orgReportTypes).values({ orgId: ORG_A, reportTypeCode: 'akc', remindDays: [7] }),
      ),
    ).rejects.toThrow(permissionDenied);
  });

  it('вид уже подключили одновременно с нами — «изменена другим пользователем», а не ошибка базы', async () => {
    await expect(
      inOrg(ORG_A, (tx) => createOrgReportType(tx, 'soc', defaults)),
    ).rejects.toBeInstanceOf(RecordChangedError);
    const history = await inOrg(ORG_A, (tx) => readHistory(tx, 'org_report_type', 'soc'));
    expect(history.map((h) => h.action)).toEqual(['create']);
  });

  it('список: весь действующий каталог, подключённые сверху, сроки словами как в прототипе', async () => {
    const page = await inOrg(ORG_A, (tx) => listOrgReportTypesPage(tx, query(), t));
    expect(page.total).toBe(activeTypes);
    expect(page.rows.slice(0, 2).map((r) => r.code)).toEqual(['nds', 'soc']);
    expect(page.rows[0]).toMatchObject({
      enabled: true,
      remindDays: [14, 3],
      due: 'до 25-го числа месяца после отчётного',
      pay: 'до 25-го числа месяца после отчётного',
      pays: 'НДС',
      authority: 'ГНС',
      regimes: ['ОНР'],
      version: 1,
      assigned: 0,
    });
    expect(page.rows[1]).toMatchObject({ needReceipt: true, needFile: false });
  });

  it('фильтр, поиск и группировка — по тексту, как на экране', async () => {
    const on = await inOrg(ORG_A, (tx) =>
      listOrgReportTypesPage(tx, query({ filters: { on: { type: 'enum', vals: ['yes'] } } }), t),
    );
    expect(on.rows.map((r) => r.code)).toEqual(['nds', 'soc']);
    const found = await inOrg(ORG_A, (tx) =>
      listOrgReportTypesPage(tx, query({ search: { q: 'и в день срока', keys: ['days'] } }), t),
    );
    expect(found.rows.map((r) => r.code)).toEqual(['nds', 'soc']);
    const byRule = await inOrg(ORG_A, (tx) =>
      listOrgReportTypesPage(
        tx,
        query({ filters: { rule: { type: 'text', q: 'после события' } } }),
        t,
      ),
    );
    expect(byRule.rows.length).toBeGreaterThan(0);
    expect(byRule.rows.every((r) => r.oneOff)).toBe(true);
    const grouped = await inOrg(ORG_A, (tx) =>
      listOrgReportTypesPage(tx, query({ group: ['act'] }), t),
    );
    expect(grouped.groups?.map((g) => g.label)).toEqual(['Сдача', 'Сдача + уплата', 'Уплата']);
  });

  it('значения для фильтра-галочек и выгрузка — с подписями словаря', async () => {
    const values = await inOrg(ORG_A, (tx) => listOrgReportTypeValues(tx, 'on', t));
    expect(values.items).toEqual([
      { value: 'yes', label: 'Да', count: 2 },
      { value: 'no', label: 'Нет', count: activeTypes - 2 },
    ]);
    const file = await inOrg(ORG_A, (tx) =>
      exportOrgReportTypes(
        tx,
        query({ filters: { on: { type: 'enum', vals: ['yes'] } } }),
        ['name', 'act', 'days'],
        t,
      ),
    );
    expect(file.rows).toEqual([
      ['НДС', 'Сдача + уплата', '14, 3 и в день срока'],
      [expect.any(String), expect.any(String), '7, 3 и в день срока'],
    ]);
  });

  it('правка с версией и историей; устаревшая версия — «изменена другим пользователем»', async () => {
    const saved = await inOrg(ORG_A, (tx) =>
      updateOrgReportType(tx, 'nds', 1, { needFile: true, remindDays: [10] }),
    );
    expect(saved).toMatchObject({ needFile: true, remindDays: [10], version: 2 });
    await expect(
      inOrg(ORG_A, (tx) => updateOrgReportType(tx, 'nds', 1, { enabled: false })),
    ).rejects.toBeInstanceOf(RecordChangedError);
    const history = await inOrg(ORG_A, (tx) => readHistory(tx, 'org_report_type', 'nds'));
    expect(history.map((h) => h.action)).toEqual(['create', 'update']);
    expect(history[1]?.changes).toEqual(
      expect.arrayContaining([
        { field: 'remindDays', from: [14, 3], to: [10] },
        { field: 'needFile', from: false, to: true },
      ]),
    );
  });

  it('«Налоги и ставки»: форма просмотра налога из refDB.json, только действующие', async () => {
    const ref = await readSpecJson<{ taxes: { code: string; active: boolean }[] }>(
      'data/refDB.json',
    );
    await db.admin.db.insert(platformReference).values({
      key: 'taxes',
      payload: [...ref.taxes, { name: 'без кода' }],
      checksum: 'test',
      source: 'test',
    });
    const taxes = await inOrg(ORG_A, (tx) => listTaxes(tx));
    expect(taxes).toHaveLength(ref.taxes.filter((x) => x.active).length);
    const vat = taxes.find((x) => x.guide.reportTypes.includes('nds'));
    expect(vat).toMatchObject({ name: 'НДС на облагаемые поставки', verify: true });
    expect(vat?.guide.rates[0]).toEqual({ rate: '12 %', when: 'обычные продажи в КР' });
    expect(vat?.guide.about).toMatch(/^Налог на добавленную стоимость/);
    // Названия кодов ГКЭД из связей — только тех, что есть в ГКЭД.
    await db.admin.db.insert(gkedItems).values({
      code: '63.11',
      name: 'Обработка данных',
      level: 'class',
      sortOrder: 1,
    });
    const names = await inOrg(ORG_A, (tx) => taxGkedNames(tx, taxes));
    expect(names).toEqual({ '63.11': 'Обработка данных' });
  });

  it('строку не удалить, дни напоминаний — от 1 до 60', async () => {
    await expect(inOrg(ORG_A, (tx) => tx.delete(orgReportTypes))).rejects.toThrow(permissionDenied);
    await expect(
      inOrg(ORG_A, (tx) => updateOrgReportType(tx, 'soc', 1, { remindDays: [61] })),
    ).rejects.toThrow(violates('org_report_types_remind_days_check'));
  });
});
