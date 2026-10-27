import { hashPassword } from '@buhuchet/adapters/password';
import {
  gkedCheck,
  RecordChangedError,
  RecordNotFoundError,
  UI_TEXTS,
  type ListQuery,
} from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import {
  assignContractors,
  contractorDictValues,
  contractorGkedDicts,
  contractorScope,
  contractorTabCounts,
  createContractor,
  deleteContractor,
  exportContractors,
  findContractorByInn,
  getContractor,
  listContractorsPage,
  listContractorValues,
  lockContractor,
  transferContractors,
  transferPreview,
  updateContractor,
  type ContractorFields,
  type ContractorListOptions,
} from './contractors';
import { readHistory, writeHistory } from './history';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  auditLog,
  contractorBases,
  contractorBenefits,
  contractorGkedExtra,
  contractors,
  contractorTariffs,
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

const TODAY = '2026-10-27';
const t = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key;
const query = (patch: Partial<ListQuery> = {}): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {}, ...patch }) as ListQuery;
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});
const violates = (constraint: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ constraint_name: constraint }) });

const fields = (patch: Partial<ContractorFields> = {}): ContractorFields => ({
  name: 'ОсОО «Ала-Тоо Трейд»',
  inn: '03744097401851',
  phone: '+996505890076',
  kind: 'regular',
  formCode: 'ФС-01',
  regimeCode: 'РЕЖ-01',
  regime2Code: null,
  gked: '46.34.0',
  gkedExtra: ['47.19.0'],
  taxOfficeCode: null,
  bizSize: 'small',
  benefits: [],
  bases: ['employees'],
  responsibleEmployeeId: null,
  head: 'Ибраимов Н. С.',
  contact: '',
  contractNo: '160/24',
  contractDate: '2024-07-16',
  note: '',
  registration: {},
  startDate: '2024-07-16',
  firstMonthMode: 'prorate',
  feeDay: 15,
  paysTo: 'emp',
  gkedConfirmation: null,
  ...patch,
});

describe.skipIf(!databaseAvailable())('Контрагенты: данные', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let accA = '';
  let chiefA = '';
  let firstId = '';
  const ctxA = (): OrgContext => ({ orgId: a.orgId, userId: a.ownerUserId });
  const ctxB = (): OrgContext => ({ orgId: b.orgId, userId: b.ownerUserId });
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, ctxA(), fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, ctxB(), fn);
  const listOptions = (patch: Partial<ContractorListOptions> = {}): ContractorListOptions => ({
    t,
    today: TODAY,
    fee: true,
    scope: undefined,
    tab: 'all',
    employeeId: a.ownerEmployeeId,
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
      slug: 'cp-a',
      owner: await owner('cp-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'cp-b',
      owner: await owner('cp-owner-b'),
    });
    const role = (code: string) => a.roles.find((r) => r.templateCode === code)!;
    [accA, chiefA] = await inA(async (tx) => [
      await createEmployee(tx, {
        fullName: 'Токтогулов Алишер Бакытович',
        shortName: 'Алишер Т.',
        login: 'cp-acc-a',
        passwordHash: 'x',
        phone: null,
        role: role('acc'),
      }),
      await createEmployee(tx, {
        fullName: 'Кадырова Мээрим Асановна',
        shortName: 'Мээрим К.',
        login: 'cp-chief-a',
        passwordHash: 'x',
        phone: null,
        role: role('chief'),
      }),
    ]);
    firstId = await inA((tx) =>
      createContractor(tx, a.orgId, fields({ responsibleEmployeeId: accA }), {
        amount: 2_800_000,
        period: 'M',
        validFrom: '2026-01-01',
        note: 'Первая ставка',
      }),
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('карточка: поля, справочные названия, дочерние записи и действующая ставка', async () => {
    const c = await inA((tx) => getContractor(tx, firstId, { scope: undefined, today: TODAY }));
    expect(c).toMatchObject({
      name: 'ОсОО «Ала-Тоо Трейд»',
      phoneText: '+996 505 890 076',
      form: { code: 'ФС-01', name: 'ОсОО', declarationFor: 'org' },
      regime: { code: 'РЕЖ-01', name: 'ОНР' },
      gked: { code: '46.34.0' },
      gkedExtra: [{ code: '47.19.0' }],
      bases: [{ code: 'employees' }],
      responsible: { id: accA, shortName: 'Алишер Т.', active: true },
      tariff: { amount: 2_800_000, period: 'M', validFrom: '2026-01-01' },
      serviceStatus: 'active',
      version: 1,
    });
    // Ставка с будущего месяца ещё не действует.
    const before = await inA((tx) =>
      getContractor(tx, firstId, { scope: undefined, today: '2025-12-31' }),
    );
    expect(before?.tariff).toBeNull();
    const [history] = await inA((tx) => readHistory(tx, 'contractor', firstId));
    expect(history).toMatchObject({ action: 'create', contractorId: firstId });
    expect(history!.changes.map((c) => c.field)).toEqual(
      expect.arrayContaining(['name', 'inn', 'responsibleEmployeeId', 'gkedExtra', 'tariff']),
    );
  });

  it('чужая организация не видна, не меняется и не удаляется', async () => {
    expect(await inB((tx) => getContractor(tx, firstId, { scope: undefined, today: TODAY }))).toBe(
      null,
    );
    expect((await inB((tx) => listContractorsPage(tx, query(), listOptions()))).rows).toEqual([]);
    expect(await inB((tx) => findContractorByInn(tx, '03744097401851'))).toBeNull();
    expect(await inB((tx) => lockContractor(tx, firstId, undefined))).toBeNull();
    await expect(
      inB((tx) => updateContractor(tx, b.orgId, firstId, 1, { name: 'Чужой' }, undefined)),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await inB((tx) => tx.delete(contractors).where(eq(contractors.id, firstId)));
    expect(await inA((tx) => lockContractor(tx, firstId, undefined))).not.toBeNull();
    // Строку с чужой организацией не вставить: политика RLS.
    await expect(
      inB((tx) =>
        tx.insert(contractors).values({ ...fields(), orgId: a.orgId, inn: '01000000000001' }),
      ),
    ).rejects.toThrow();
    // Тот же ИНН в другой организации — можно: дубль ищется только в своей.
    const other = await inB((tx) => createContractor(tx, b.orgId, fields(), null));
    expect(other).not.toBe(firstId);
    // Без контекста организации не видно ничего.
    const rows = await db.app.db.transaction((tx) => tx.select().from(contractors));
    expect(rows).toEqual([]);
  });

  it('дочерние записи чужой организации не видны и не создаются', async () => {
    const children = [
      [contractorGkedExtra, { gked: '62.01.0', sortOrder: 5 }],
      [contractorBenefits, { benefitCode: 'ЛЬГ-01', validFrom: null, validTo: null }],
      [contractorBases, { baseCode: 'property' }],
      [
        contractorTariffs,
        { amount: 100, period: 'M' as const, validFrom: '2026-02-01', note: 'Чужая' },
      ],
    ] as const;
    // В А у первого контрагента есть дополнительный ГКЭД, основание и ставка; Б их не видит.
    for (const [table] of children) {
      const own = await inA((tx) => tx.select().from(table).where(eq(table.contractorId, firstId)));
      const foreign = await inB((tx) =>
        tx.select().from(table).where(eq(table.contractorId, firstId)),
      );
      expect(foreign).toEqual([]);
      if (table !== contractorBenefits) expect(own.length).toBeGreaterThan(0);
    }
    // Б не добавит запись к контрагенту А: ни от имени А (политика RLS), ни от своего (составной
    // внешний ключ на контрагента своей организации).
    for (const [table, values] of children) {
      for (const orgId of [a.orgId, b.orgId]) {
        await expect(
          inB((tx) =>
            tx.insert(table as never).values({ ...values, orgId, contractorId: firstId } as never),
          ),
        ).rejects.toThrow();
      }
    }
  });

  it('запись истории не ссылается на контрагента другой организации', async () => {
    const foreign = await inB((tx) => findContractorByInn(tx, '03744097401851'));
    await expect(
      inA((tx) =>
        writeHistory(tx, {
          entity: 'contractor',
          entityId: foreign!.id,
          action: 'update',
          contractorId: foreign!.id,
        }),
      ),
    ).rejects.toEqual(violates('audit_log_contractor_fk'));
  });

  it('область «Свои контрагенты»: чужой ответственный — не найден', async () => {
    const own = contractorScope(chiefA);
    expect(await inA((tx) => getContractor(tx, firstId, { scope: own, today: TODAY }))).toBeNull();
    expect(
      (await inA((tx) => listContractorsPage(tx, query(), listOptions({ scope: own })))).rows,
    ).toEqual([]);
    await expect(
      inA((tx) => updateContractor(tx, a.orgId, firstId, 1, { note: 'x' }, own)),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    const mine = contractorScope(accA);
    expect(await inA((tx) => getContractor(tx, firstId, { scope: mine, today: TODAY }))).not.toBe(
      null,
    );
  });

  it('сохранение со сбоем не создаёт ничего', async () => {
    const inn = '01234567890123';
    await expect(
      inA((tx) =>
        createContractor(
          tx,
          a.orgId,
          fields({ inn, benefits: [{ code: 'ЛЬГ-нет', validFrom: null, validTo: null }] }),
          { amount: 100, period: 'M', validFrom: '2026-10-01', note: '' },
        ),
      ),
    ).rejects.toThrow();
    expect(await inA((tx) => findContractorByInn(tx, inn))).toBeNull();
    const left = await db.admin.db.select().from(contractorTariffs);
    expect(left.every((x) => x.contractorId !== undefined && x.amount !== 100)).toBe(true);
    // Повторное сохранение не упирается в ИНН наполовину созданной записи.
    const id = await inA((tx) => createContractor(tx, a.orgId, fields({ inn }), null));
    expect(id).toBeTruthy();
    await inA(async (tx) => {
      const row = await lockContractor(tx, id, undefined);
      await deleteContractor(tx, row!);
    });
  });

  it('ИНН: дубль из архива находится с названием; второй такой же в организации не сохранить', async () => {
    const inn = '11234567890123';
    const id = await inA((tx) =>
      createContractor(tx, a.orgId, fields({ inn, name: 'ИП Асанов' }), null),
    );
    await db.admin.db
      .update(contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(contractors.id, id));
    expect(await inA((tx) => findContractorByInn(tx, inn))).toEqual({
      id,
      name: 'ИП Асанов',
      archived: true,
      responsibleEmployeeId: null,
    });
    expect(await inA((tx) => findContractorByInn(tx, inn, id))).toBeNull();
    await expect(inA((tx) => createContractor(tx, a.orgId, fields({ inn }), null))).rejects.toEqual(
      violates('contractors_org_inn_key'),
    );
    // Архивный в списке не виден, пока фильтр «Статус обслуживания» его не покажет.
    const live = await inA((tx) => listContractorsPage(tx, query(), listOptions()));
    expect(live.rows.some((r) => r.id === id)).toBe(false);
    const archived = await inA((tx) =>
      listContractorsPage(
        tx,
        query({ filters: { service: { type: 'enum', vals: ['archived'] } } }),
        listOptions(),
      ),
    );
    expect(archived.rows.map((r) => r.id)).toEqual([id]);
    // Архивному ответственного не назначить.
    expect(await inA((tx) => assignContractors(tx, [id], chiefA, undefined))).toEqual({
      changed: 0,
      archived: [id],
    });
  });

  it('журнал тарифов не меняется и не удаляется; с контрагентом удаляется каскадом', async () => {
    await expect(inA((tx) => tx.update(contractorTariffs).set({ amount: 1 }))).rejects.toEqual(
      permissionDenied,
    );
    await expect(inA((tx) => tx.delete(contractorTariffs))).rejects.toEqual(permissionDenied);
    const id = await inA((tx) =>
      createContractor(tx, a.orgId, fields({ inn: '21234567890123' }), {
        amount: 0,
        period: 'Y',
        validFrom: '2026-10-01',
        note: '',
      }),
    );
    await inA(async (tx) => {
      const row = await lockContractor(tx, id, undefined);
      await deleteContractor(tx, row!);
    });
    const tariffs = await db.admin.db
      .select()
      .from(contractorTariffs)
      .where(eq(contractorTariffs.contractorId, id));
    expect(tariffs).toEqual([]);
    // История остаётся, ссылка на удалённого пропадает.
    const history = await db.admin.db.select().from(auditLog).where(eq(auditLog.entityId, id));
    expect(history.map((h) => [h.action, h.contractorId])).toEqual([
      ['create', null],
      ['delete', null],
    ]);
    // Месяц ставки — первое число.
    await expect(
      inA((tx) =>
        createContractor(tx, a.orgId, fields({ inn: '21234567890124' }), {
          amount: 1,
          period: 'M',
          validFrom: '2026-10-15',
          note: '',
        }),
      ),
    ).rejects.toEqual(violates('contractor_tariffs_month_check'));
  });

  it('изменение: поля и дочерние записи — в историю; устаревшая версия — отказ', async () => {
    const id = await inA((tx) =>
      createContractor(tx, a.orgId, fields({ inn: '01999999999999' }), null),
    );
    await inA((tx) =>
      updateContractor(
        tx,
        a.orgId,
        id,
        1,
        {
          name: 'ОсОО «Новое»',
          gkedExtra: ['47.19.0', '62.01.0'],
          benefits: [{ code: 'ЛЬГ-01', validFrom: '2026-01-01', validTo: null }],
          bases: ['employees'],
        },
        undefined,
      ),
    );
    const c = await inA((tx) => getContractor(tx, id, { scope: undefined, today: TODAY }));
    expect(c).toMatchObject({
      name: 'ОсОО «Новое»',
      version: 2,
      gkedExtra: [{ code: '47.19.0' }, { code: '62.01.0' }],
      benefits: [{ code: 'ЛЬГ-01', validFrom: '2026-01-01', validTo: null }],
    });
    const history = await inA((tx) => readHistory(tx, 'contractor', id));
    expect(history.at(-1)!.changes).toEqual([
      { field: 'name', from: 'ОсОО «Ала-Тоо Трейд»', to: 'ОсОО «Новое»' },
      { field: 'gkedExtra', from: ['47.19.0'], to: ['47.19.0', '62.01.0'] },
      {
        field: 'benefits',
        from: [],
        to: [{ code: 'ЛЬГ-01', validFrom: '2026-01-01', validTo: null }],
      },
    ]);
    await expect(
      inA((tx) => updateContractor(tx, a.orgId, id, 1, { gkedExtra: [] }, undefined)),
    ).rejects.toBeInstanceOf(RecordChangedError);
    const after = await inA((tx) => getContractor(tx, id, { scope: undefined, today: TODAY }));
    expect(after?.gkedExtra).toHaveLength(2);
  });

  it('закрепление и передача дел — с историей; «Кому» по умолчанию — главный бухгалтер', async () => {
    const id = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        fields({ inn: '02000000000001', responsibleEmployeeId: accA }),
        null,
      ),
    );
    expect(await inA((tx) => transferPreview(tx, accA))).toEqual({
      contractors: 2,
      defaultTo: chiefA,
    });
    expect(await inA((tx) => transferContractors(tx, accA, chiefA))).toBe(2);
    const c = await inA((tx) => getContractor(tx, id, { scope: undefined, today: TODAY }));
    expect(c?.responsible?.id).toBe(chiefA);
    const history = await inA((tx) => readHistory(tx, 'contractor', id));
    expect(history.at(-1)).toMatchObject({
      action: 'update',
      actorUserId: a.ownerUserId,
      changes: [{ field: 'responsibleEmployeeId', from: accA, to: chiefA }],
    });
    // Тот же ответственный — без изменений и без записи.
    expect(await inA((tx) => assignContractors(tx, [id, firstId], chiefA, undefined))).toEqual({
      changed: 0,
      archived: [],
    });
    // Вне области — «не найден», ничего не меняется.
    await expect(
      inA((tx) => assignContractors(tx, [id], accA, contractorScope(accA))),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(await inA((tx) => contractorTabCounts(tx, undefined, chiefA))).toMatchObject({
      mine: 2,
    });
    await inA((tx) => assignContractors(tx, [id, firstId], accA, undefined));
  });

  it('список: вкладка «Мои», столбцы, поиск по телефону без пробелов, значения и выгрузка', async () => {
    const mine = await inA((tx) =>
      listContractorsPage(tx, query(), listOptions({ tab: 'mine', employeeId: accA })),
    );
    expect(mine.rows.length).toBeGreaterThan(0);
    expect(mine.rows.every((r) => r.responsible?.id === accA)).toBe(true);
    const row = mine.rows.find((r) => r.id === firstId)!;
    expect(row).toMatchObject({
      form: 'ОсОО',
      regime: 'ОНР',
      gked: { code: '46.34.0' },
      gkedExtra: '47.19.0',
      tariff: { amount: 2_800_000, period: 'M' },
    });
    const found = await inA((tx) =>
      listContractorsPage(tx, query({ search: { q: '505 890 076', keys: [] } }), listOptions()),
    );
    expect(found.rows.map((r) => r.id)).toContain(firstId);
    const values = await inA((tx) => listContractorValues(tx, 'regime', listOptions(), query()));
    expect(values.items.find((v) => v.value === 'РЕЖ-01')).toMatchObject({ label: 'ОНР' });
    const file = await inA((tx) =>
      exportContractors(tx, query(), ['name', 'phone', 'contract', 'fee'], listOptions()),
    );
    expect(file.rows.find((r) => r[0] === 'ОсОО «Ала-Тоо Трейд»')).toEqual([
      'ОсОО «Ала-Тоо Трейд»',
      '+996 505 890 076',
      '№ 160/24 от 16.07.2024',
      2_800_000,
    ]);
    // Без права «Видеть плату за обслуживание» столбца стоимости нет.
    await expect(
      inA((tx) => exportContractors(tx, query(), ['fee'], listOptions({ fee: false }))),
    ).rejects.toThrow(/столбец/);
  });

  it('справочники для сверки с ГКЭД: предки кода, группы, запрет ЕН банку', async () => {
    const dicts = await inA((tx) => contractorGkedDicts(tx, ['64.19.1']));
    expect([...dicts.index.keys()]).toEqual(
      expect.arrayContaining(['64.19.1', '64.19', '64.1', '64', 'K']),
    );
    expect(dicts.groups.find((g) => g.id === 'internet')?.ask).toBe('Оказывает услуги интернета?');
    const check = gkedCheck(
      {
        gked: '64.19.1',
        gkedExtra: [],
        form: { code: 'ФС-01', declarationFor: 'org' },
        regimes: ['РЕЖ-03'],
        benefits: [],
      },
      dicts,
    );
    expect(check.block).toEqual([
      expect.objectContaining({ regime: 'РЕЖ-03', code: '64.19.1', article: 'ст. 419' }),
    ]);
    const values = await inA((tx) =>
      contractorDictValues(tx, {
        forms: ['ФС-01'],
        regimes: ['РЕЖ-03', 'нет'],
        benefits: [],
        bases: ['employees'],
        taxOffices: [],
        gked: ['64.19.1', '64.19'],
      }),
    );
    expect(values.forms.get('ФС-01')).toEqual({ active: true, declarationFor: 'org' });
    expect(values.regimes.has('нет')).toBe(false);
    expect(values.gked.get('64.19')?.level).not.toBe(values.gked.get('64.19.1')?.level);
  });

  it('ИНН — 14 цифр и проверка второго режима — в самой базе', async () => {
    await expect(
      inA((tx) => createContractor(tx, a.orgId, fields({ inn: '123' }), null)),
    ).rejects.toEqual(violates('contractors_inn_check'));
    await expect(
      inA((tx) =>
        createContractor(
          tx,
          a.orgId,
          fields({ inn: '01888888888888', regimeCode: 'РЕЖ-01', regime2Code: 'РЕЖ-01' }),
          null,
        ),
      ),
    ).rejects.toEqual(violates('contractors_regime2_check'));
    const [row] = (await db.admin.db.execute(
      sql`select count(*)::int as n from contractors where inn = '01888888888888'`,
    )) as unknown as { n: number }[];
    expect(row?.n).toBe(0);
  });
});
