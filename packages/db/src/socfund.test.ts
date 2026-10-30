import { hashPassword } from '@buhuchet/adapters/password';
import { UI_TEXTS, type ListQuery } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import {
  createContractor,
  exportContractors,
  getContractor,
  listContractorsPage,
  listContractorValues,
  type ContractorFields,
  type ContractorListOptions,
} from './contractors';
import { createOrganization, type CreatedOrganization } from './organizations';
import { seedPermissions, seedRoleTemplates } from './seed';
import { activeReportTypes, penaltyOf, socfundDict, socfundStatusCode } from './socfund';
import { readSpecJson } from './spec-data';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const TODAY = '2026-10-27';
const t = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key;
const query = (patch: Partial<ListQuery> = {}): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {}, ...patch }) as ListQuery;
const violates = (constraint: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ constraint_name: constraint }) });

const ALL_YES = { cashless: true, registry: true, confirmed: true, gov: false };

let inn = 100;
const fields = (patch: Partial<ContractorFields> = {}): ContractorFields => ({
  name: `ОсОО «Соцфонд ${inn}»`,
  inn: `0374409740${String(inn++).padStart(4, '0')}`,
  phone: '+996505890076',
  kind: 'regular',
  formCode: 'ФС-01',
  regimeCode: 'РЕЖ-01',
  regime2Code: null,
  gked: '47.11.0',
  gkedExtra: [],
  taxOfficeCode: null,
  bizSize: 'small',
  benefits: [],
  bases: ['employees'],
  responsibleEmployeeId: null,
  head: '',
  contact: '',
  contractNo: '',
  contractDate: null,
  note: '',
  registration: {},
  startDate: '2026-01-15',
  firstMonthMode: 'prorate',
  feeDay: 15,
  paysTo: 'emp',
  gkedConfirmation: null,
  socfundFlags: {},
  socfundTariff: null,
  ...patch,
});

describe.skipIf(!databaseAvailable())('Тариф Соцфонда: данные', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  const ctx = (o: CreatedOrganization): OrgContext => ({ orgId: o.orgId, userId: o.ownerUserId });
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, ctx(a), fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, ctx(b), fn);
  const listOptions = (o: CreatedOrganization): ContractorListOptions => ({
    t,
    today: TODAY,
    fee: false,
    scope: undefined,
    tab: 'all',
    employeeId: o.ownerEmployeeId,
  });
  const create = (patch: Partial<ContractorFields>) =>
    inA((tx) => createContractor(tx, a.orgId, fields(patch), null));

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
      slug: 'sf-a',
      owner: await owner('sf-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'sf-b',
      owner: await owner('sf-owner-b'),
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('справочные данные: тарифы по порядку, статус СПиНО, статусы резидентов, вид STI-161, предки ГКЭД', async () => {
    const { dict, guide } = await inA((tx) => socfundDict(tx, ['47.11.0', '64.19.1']));
    expect(dict.tariffs.map((x) => [x.id, x.short, x.total])).toEqual([
      ['spino', 'СПиНО', '12,25 %'],
      ['general', 'Базовый тариф', '27,25 %'],
      ['pvtpki', 'Тариф ПВТ / ПКИ', '12 % от среднемесячной зарплаты'],
    ]);
    expect(socfundStatusCode(dict)).toBe('ЛЬГ-29');
    expect(dict.status?.ex).toContain('64.19.1');
    expect(dict.status?.warnForms).toEqual(['ФС-12', 'ФС-13', 'ФС-14']);
    expect([...dict.statusNames]).toEqual([
      ['ЛЬГ-01', 'Резидент ПКИ'],
      ['ЛЬГ-02', 'Резидент ПВТ'],
    ]);
    expect(dict.reportTypes).toEqual(['soc']);
    expect(dict.gkedNames.get('64.19.1')).toBeTruthy();
    expect([...dict.index.keys()]).toEqual(
      expect.arrayContaining(['47.11.0', '47', 'G', '64.19.1']),
    );
    expect(guide.tariffs.map((x) => x.id)).toEqual(['spino', 'general', 'pvtpki']);
    expect(guide.tariffs[0]!.parts.length).toBeGreaterThan(0);
    expect(guide.tariffs[0]!.cap?.amount).toBeTruthy();
  });

  it('пеня — по виду отчёта налога с пеней; у вида без пени — нет', async () => {
    expect(await inA((tx) => penaltyOf(tx, 'soc'))).toEqual({
      start: 'с 21-го числа',
      rate: '0,09 % от долга за каждый день просрочки',
      cap: 'пеня не больше 100 % долга',
    });
    expect(await inA((tx) => penaltyOf(tx, 'нет такого'))).toBeNull();
  });

  it('признаки и тариф хранятся у контрагента; неверные значения не пропускает сама база', async () => {
    const id = await create({
      socfundFlags: ALL_YES,
      socfundTariff: { id: 'spino', manual: false, reason: null },
    });
    expect(
      await inA((tx) => getContractor(tx, id, { scope: undefined, today: TODAY })),
    ).toMatchObject({
      socfundFlags: ALL_YES,
      socfundTariff: { id: 'spino', manual: false, reason: null },
    });
    expect(await inA((tx) => activeReportTypes(tx, id))).toEqual([]);

    const bad: [Partial<ContractorFields>, string][] = [
      [{ socfundFlags: { cashless: 'да' } as never }, 'contractors_socfund_flags_check'],
      [{ socfundFlags: { salary: true } as never }, 'contractors_socfund_flags_check'],
      [{ socfundFlags: { cashless: null } as never }, 'contractors_socfund_flags_check'],
      [{ socfundTariff: { id: 'other' } as never }, 'contractors_socfund_tariff_check'],
      // Без ключа id или manual — тоже нельзя.
      [{ socfundTariff: { id: 'spino' } as never }, 'contractors_socfund_tariff_check'],
      [
        { socfundTariff: { manual: false, reason: null } as never },
        'contractors_socfund_tariff_check',
      ],
      [
        { socfundTariff: { id: 'spino', manual: 'да', reason: null } as never },
        'contractors_socfund_tariff_check',
      ],
      // Причина — только у ручного выбора.
      [
        { socfundTariff: { id: 'spino', manual: false, reason: 'письмо' } },
        'contractors_socfund_tariff_check',
      ],
      [
        { socfundTariff: { id: 'spino', manual: true, reason: null, extra: 1 } as never },
        'contractors_socfund_tariff_check',
      ],
    ];
    for (const [patch, constraint] of bad) {
      await expect(create(patch)).rejects.toEqual(violates(constraint));
    }
    await expect(
      create({ socfundTariff: { id: 'general', manual: true, reason: 'письмо ГНС' } }),
    ).resolves.toBeTruthy();
    const [row] = (await db.admin.db.execute(
      sql`select count(*)::int as n from contractors where socfund_flags ? 'salary'`,
    )) as unknown as { n: number }[];
    expect(row?.n).toBe(0);
  });

  it('список: «Тариф Соцфонда» и «Тариф под вопросом» — столбцы, фильтр, значения и выгрузка', async () => {
    const spino = await create({
      name: 'ОсОО «СПиНО по условиям»',
      socfundFlags: ALL_YES,
      socfundTariff: { id: 'spino', manual: false, reason: null },
    });
    const none = await create({ name: 'ОсОО «Без тарифа»', socfundFlags: ALL_YES });
    // Резидент ПКИ со СПиНО вручную — вопреки условиям: под вопросом.
    const manual = await create({
      name: 'ОсОО «СПиНО вручную»',
      gked: '62.01.0',
      benefits: [
        { code: 'ЛЬГ-01', validFrom: null, validTo: null },
        { code: 'ЛЬГ-29', validFrom: null, validTo: null },
      ],
      socfundTariff: { id: 'spino', manual: true, reason: 'письмо ГНС' },
    });
    const oneoff = await create({ name: 'ИП разовый', kind: 'oneoff', bases: [] });

    const page = await inA((tx) => listContractorsPage(tx, query(), listOptions(a)));
    const row = (id: string) => page.rows.find((r) => r.id === id)?.socfund;
    expect(row(spino)).toEqual({ id: 'spino', short: 'СПиНО', total: '12,25 %', ask: false });
    expect(row(none)).toEqual({ id: null, short: 'Не определён', total: '', ask: true });
    expect(row(manual)).toEqual({ id: 'spino', short: 'СПиНО', total: '12,25 %', ask: true });
    expect(row(oneoff)).toBeNull();

    const asked = await inA((tx) =>
      listContractorsPage(
        tx,
        query({ filters: { socfundAsk: { type: 'enum', vals: ['yes'] } } }),
        listOptions(a),
      ),
    );
    expect(asked.rows.map((r) => r.id).sort()).toEqual([none, manual].sort());
    const values = await inA((tx) => listContractorValues(tx, 'socfund', listOptions(a), query()));
    expect(values.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'spino', label: 'СПиНО' }),
        expect.objectContaining({ value: 'none', label: 'Не определён' }),
      ]),
    );
    const file = await inA((tx) =>
      exportContractors(tx, query(), ['name', 'socfund', 'socfundAsk'], listOptions(a)),
    );
    expect(file.rows).toEqual(
      expect.arrayContaining([
        ['ОсОО «СПиНО по условиям»', 'СПиНО', 'Нет'],
        ['ОсОО «Без тарифа»', 'Не определён', 'Да'],
        ['ИП разовый', null, 'Нет'],
      ]),
    );

    // Другая организация не видит ни контрагентов, ни их тарифов.
    const other = await inB((tx) => listContractorsPage(tx, query(), listOptions(b)));
    expect(other.rows).toEqual([]);
  });
});
