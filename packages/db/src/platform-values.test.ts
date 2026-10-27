import { ORG_DICT_COLUMNS, UI_TEXTS, type ListQuery } from '@buhuchet/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { ListQueryError } from './list';
import {
  exportPlatformDict,
  exportPlatformValues,
  listPlatformDictPage,
  listPlatformDictValues,
  listPlatformValuesPage,
  listPlatformValueValues,
  platformDictTiles,
} from './platform-values';
import { organizations, platformReference, taxRegimes } from './schema';
import { readSpecJson } from './spec-data';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const ORG = '0c3e5f70-0000-4000-8000-0000000000c1';
const TODAY = '2026-10-27';

const t = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key;
const query = (patch: Partial<ListQuery> = {}): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {}, ...patch }) as ListQuery;

describe.skipIf(!databaseAvailable())('Справочники платформы глазами организации', () => {
  let db: TestDatabase;
  let refDB: Record<string, unknown>;
  const inOrg = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: ORG }, fn);

  beforeAll(async () => {
    db = await createTestDatabase();
    refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedAllPlatformDictionaries(db.admin.db);
    await db.admin.db.insert(organizations).values({ id: ORG, slug: 'pv', name: 'Организация' });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('плитки по группам: без служебных справочников, «Ставки единого налога» после налогов, числа значений', async () => {
    const groups = await inOrg((tx) => platformDictTiles(tx, t, TODAY));
    expect(groups.map((g) => g.group)).toEqual([
      'Налоги и отчёты',
      'Режимы, льготы и статусы',
      'Классификаторы',
      'Органы и банки',
      'Работа системы',
    ]);
    const tiles = groups.flatMap((g) => g.tabs);
    expect(tiles.map((x) => x.tab)).not.toContain('Шаблоны ролей');
    expect(tiles.map((x) => x.tab)).not.toContain('Права ролей');
    expect(tiles.slice(0, 3).map((x) => x.id)).toEqual(['taxes', 'en_rates', 'types']);
    const count = (id: string) => tiles.find((x) => x.id === id)!.count;
    const ref = refDB as {
      enRates: unknown[];
      statusNotes: Record<string, string>;
      dictionaries: Record<string, { items: { active?: boolean }[] }>;
    };
    expect(count('en_rates')).toBe(ref.enRates.length);
    expect(count('statuses')).toBe(Object.keys(ref.statusNotes).length);
    const active = (d: string) => ref.dictionaries[d]!.items.filter((x) => x.active).length;
    expect(count('regimes')).toBe(active('regimes'));
    expect(count('banks')).toBe(active('banks'));
    expect(count('cats')).toBe(active('cats') + active('reasons'));
    const gked = await inOrg((tx) => listPlatformDictPage(tx, 'gked', query(), t, TODAY));
    expect(count('gked')).toBe(gked.total);
    expect(gked.total).toBeGreaterThan(500);
    expect(tiles.find((x) => x.id === 'en_rates')).toMatchObject({
      tab: 'Ставки единого налога',
      usedIn: 'Ставка ЕН контрагента по основному ГКЭД; подсказка в форме контрагента.',
    });
  });

  it('окно справочника: столбцы как в прототипе, пояснение в своём столбце, поиск и сортировка', async () => {
    const regimes = await inOrg((tx) => listPlatformDictPage(tx, 'regimes', query(), t, TODAY));
    const onr = regimes.rows.find((r) => r.id === 'РЕЖ-01')!;
    expect(Object.keys(onr.values)).toEqual(ORG_DICT_COLUMNS.regimes.map((c) => c.key));
    expect(onr.values.name).toBe('ОНР');
    // «Для бухгалтера:» в начале пояснения не повторяется.
    expect(regimes.rows.every((r) => !r.values.acc!.startsWith('Для бухгалтера'))).toBe(true);
    // По умолчанию — по первому столбцу.
    const names = regimes.rows.map((r) => r.values.name!);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'ru')));

    const found = await inOrg((tx) =>
      listPlatformDictPage(tx, 'forms', query({ search: { q: 'ИП', keys: [] } }), t, TODAY),
    );
    expect(found.rows.length).toBeGreaterThan(0);
    const ip = found.rows.find((r) => r.values.name === 'ИП')!;
    expect(ip.values.end).toBe('ИП');

    const statuses = await inOrg((tx) => listPlatformDictPage(tx, 'statuses', query(), t, TODAY));
    // Статусы — в порядке шкалы, без сортировки.
    expect(statuses.rows[0]!.values).toEqual({
      name: 'К сдаче',
      note: 'отчёт создан, работа не начата',
    });

    expect(statuses.rows.map((r) => r.id)).toEqual([
      'todo',
      'in_progress',
      'submitted',
      'waiting',
      'confirmed',
      'needs_fix',
      'not_required',
    ]);
    const templates = await inOrg((tx) => listPlatformDictPage(tx, 'templates', query(), t, TODAY));
    expect(templates.rows.slice(0, 2).map((r) => r.id)).toEqual(['waTax', 'waFee']);
    expect(templates.rows[0]!.values.text).toContain('{контрагент}');

    const taxes = await inOrg((tx) => listPlatformDictPage(tx, 'taxes', query(), t, TODAY));
    expect(taxes.rows.some((r) => r.values.verify === '1')).toBe(true);
  });

  it('календарь — текущий год по дате, тип словами; категории задач вместе с причинами изменения срока', async () => {
    const calendar = await inOrg((tx) => listPlatformDictPage(tx, 'calendar', query(), t, TODAY));
    expect(calendar.rows.every((r) => r.values.d!.startsWith('2026-'))).toBe(true);
    expect(calendar.rows[0]!.values).toEqual({
      d: '2026-01-01',
      name: 'Новый год',
      kind: 'Праздник',
    });
    const kinds = await inOrg((tx) => listPlatformDictValues(tx, 'calendar', 'kind', t, TODAY));
    expect(kinds.items.map((x) => x.label)).toContain('Перенос');

    const cats = await inOrg((tx) => listPlatformDictPage(tx, 'cats', query(), t, TODAY));
    const lists = new Set(cats.rows.map((r) => r.values.kind));
    expect([...lists].sort()).toEqual(['Категория задачи', 'Причина изменения срока']);
  });

  it('выгрузка окна в Excel и неизвестный столбец', async () => {
    const file = await inOrg((tx) =>
      exportPlatformDict(tx, 'banks', query(), ['name', 'code'], t, TODAY),
    );
    expect(file.columns.map((c) => c.label)).toEqual([
      'dicts.platform.col.banks.name',
      'dicts.platform.col.banks.code',
    ]);
    expect(file.rows.length).toBeGreaterThan(10);
    await expect(
      inOrg((tx) =>
        listPlatformDictPage(tx, 'banks', query({ sort: { key: 'gives', dir: 'asc' } }), t, TODAY),
      ),
    ).rejects.toThrow(ListQueryError);
  });

  it('«Поиск по всем значениям»: справочник и значение, кто менял, фильтр по справочнику', async () => {
    const page = await inOrg((tx) =>
      listPlatformValuesPage(tx, query({ search: { q: 'Нооруз', keys: [] } }), t, TODAY),
    );
    expect(page.rows).toEqual([
      expect.objectContaining({
        dict: 'calendar',
        dictName: 'Производственный календарь',
        name: '21.03.2026 — Нооруз',
      }),
    ]);
    const kg = await inOrg((tx) =>
      listPlatformValuesPage(tx, query({ search: { q: 'Кыргызстан', keys: [] } }), t, TODAY),
    );
    expect(kg.rows.map((r) => r.name)).toContain('🇰🇬 Кыргызстан +996 · XXX XXX XXX');

    // Правка администратора платформы видна в «Изменил»; у банков (раздел без таблицы) — пусто.
    await db.admin.db
      .update(taxRegimes)
      .set({ updatedAt: new Date('2026-10-20T04:00:00Z') })
      .where(eq(taxRegimes.code, 'РЕЖ-01'));
    const regimes = await inOrg((tx) =>
      listPlatformValuesPage(
        tx,
        query({ filters: { d: { type: 'enum', vals: ['regimes'] } } }),
        t,
        TODAY,
      ),
    );
    expect(regimes.rows.every((r) => r.dict === 'regimes')).toBe(true);
    expect(regimes.rows.find((r) => r.name === 'ОНР')!.audit.updatedAt).toBe(
      '2026-10-20T04:00:00.000Z',
    );

    const dicts = await inOrg((tx) => listPlatformValueValues(tx, 'd', t, TODAY));
    expect(dicts.items.map((x) => x.label)).toContain('Банковские провайдеры');
    const file = await inOrg((tx) => exportPlatformValues(tx, query(), ['d', 'name'], t, TODAY));
    expect(file.columns.map((c) => c.label)).toEqual([
      'dicts.platform.col.all.d',
      'dicts.platform.col.all.name',
    ]);
    expect(file.rows[0]![0]).toBe('Банковские провайдеры');
  });

  it('раздел групп, который не разобрать, — плиток нет, экран не падает', async () => {
    await db.admin.db
      .update(platformReference)
      .set({ payload: { broken: true } })
      .where(eq(platformReference.key, 'dictGroups'));
    expect(await inOrg((tx) => platformDictTiles(tx, t, TODAY))).toEqual([]);
  });
});
