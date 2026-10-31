import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ApiError,
  ContractorImportCheck,
  ContractorImportResult,
  ContractorImportTemplate,
} from '@buhuchet/shared';
import { CP_IMPORT_CELL_MAX } from '@buhuchet/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSheetRows } from '../../lists/xlsx-read';
import { CP_IMPORT_RATE_LIMIT } from './import';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

// Загрузка контрагентов из Excel (задача 2.16; прототип modules/contractor-import.js). Сегодня в
// тестах — 18.10.2026: обслуживание загруженных — с 01.10.2026.
describe.skipIf(!databaseAvailable())('Загрузка контрагентов из Excel: методы API', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let acc: string;
  let senior: string;
  let ownerB: string;

  const MAP = ['name', 'inn', 'phone', 'types', 'fee', 'resp', 'regime', 'gked'];
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const call = (path: string, cookie: string | undefined, body: unknown) =>
    apiRequest(f.app, 'POST', path, cookie, body);
  const checked = async (rows: string[][], map = MAP, cookie = owner) => {
    const res = await call('/api/contractors/import/check', cookie, { map, rows });
    expect(res.status, await res.clone().text()).toBe(200);
    return ContractorImportCheck.parse(await res.json());
  };
  const applied = async (rows: string[][], map = MAP, cookie = owner) => {
    const res = await call('/api/contractors/import', cookie, { map, rows });
    expect(res.status, await res.clone().text()).toBe(200);
    return ContractorImportResult.parse(await res.json());
  };
  const byInn = async (inn: string, orgId = f.a.orgId) => {
    const [row] = await f.t.admin.db
      .select()
      .from(schema.contractors)
      .where(and(eq(schema.contractors.orgId, orgId), eq(schema.contractors.inn, inn)));
    return row;
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    // Функция «Плата за обслуживание» включена у организации А: владелец и главный бухгалтер видят
    // плату, «Кадры» (права бухгалтера) — нет.
    await f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: { fee: true } })
      .where(eq(schema.orgSettings.orgId, f.a.orgId));
    [owner, chief, acc, senior, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'senior-a', TEST_PASSWORD),
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

  it('без входа — 401; без права «Загружать контрагентов списком» — 403; неверная вставка — 400', async () => {
    const body = { map: MAP, rows: [['ОсОО «А»']] };
    expect((await call('/api/contractors/import/check', undefined, body)).status).toBe(401);
    expect((await call('/api/contractors/import', undefined, body)).status).toBe(401);
    for (const path of [
      '/api/contractors/import/template/preview',
      '/api/contractors/import/template',
    ]) {
      expect((await apiRequest(f.app, 'GET', path, undefined)).status).toBe(401);
    }
    for (const cookie of [acc, senior]) {
      const res = await call('/api/contractors/import/check', cookie, body);
      expect(res.status).toBe(403);
      expect((await call('/api/contractors/import', cookie, body)).status).toBe(403);
      expect(
        (await apiRequest(f.app, 'GET', '/api/contractors/import/template/preview', cookie)).status,
      ).toBe(403);
      expect(
        (await apiRequest(f.app, 'GET', '/api/contractors/import/template', cookie)).status,
      ).toBe(403);
    }
    const bad = [
      { map: ['name', 'чужая'], rows: [['А']] },
      { map: MAP, rows: [] },
      { map: MAP, rows: Array.from({ length: 501 }, () => ['А']) },
      { map: MAP, rows: [['Я'.repeat(CP_IMPORT_CELL_MAX + 1)]] },
      { map: [], rows: [['А']] },
    ];
    for (const b of bad) {
      const res = await call('/api/contractors/import/check', owner, b);
      expect(res.status, JSON.stringify(b).slice(0, 80)).toBe(400);
      expect((await failure(res)).code).toBe('validation_failed');
    }
  });

  it('«Проверить»: ошибки и предупреждения строк по порядку прототипа, сколько готово', async () => {
    const r = await checked([
      [
        'ОсОО «Жашыл Талаа»',
        '01504202010077',
        '+996 555 404 404',
        'НДС',
        '15000',
        'acc-a',
        'ОНР',
        '69.20.0',
      ],
      ['ИП Бектурова Ж. А.', '21002199001234', '0700 112 233', 'НДС', '6000', 'chief-a', 'ОНР', ''],
      [
        'ОсОО «Азия Кофе»',
        '0160320181',
        '555 778 900',
        'НДС, Отчёт-призрак',
        'много',
        'Нурлан Б.',
        'ОНР',
        '69.20',
      ],
      ['ОсОО «Повтор»', '01504202010077', '555 778 901', 'ЕН кв.', '0', '', 'ОНР', '99.99.9'],
    ]);
    expect(r.ready).toBe(2);
    expect(r.rows).toEqual([
      { errors: [], warnings: [] },
      { errors: [], warnings: ['без ГКЭД'] },
      {
        errors: [
          'ИНН не 14 цифр',
          'вид «Отчёт-призрак» не найден',
          'стоимость не число',
          'сотрудник «Нурлан Б.» не найден',
          'ГКЭД «69.20» — не подкласс, укажите код вида 69.20.0',
        ],
        warnings: [],
      },
      {
        errors: [
          'ИНН повторяется в списке',
          'не указан ответственный',
          'ГКЭД «99.99.9» нет в справочнике',
          // ОТКЛОНЕНИЕ: docs/deviations.md#А-9 — вид не подходит к режиму, как в форме создания.
          'вид «ЕН кв.» не подходит: Не подходит к режиму «ОНР»',
        ],
        warnings: [],
      },
    ]);
  });

  it('пустая колонка «Виды отчётов»: отчёты «Обязательно по режиму», «По статусу» и «Для всех» — с предупреждением; без режима и подбора — ошибка', async () => {
    const r = await checked(
      [
        ['ОсОО «Авто»', '01504202010078', '555 404 405', '', '1000', 'acc-a', 'ОНР', '69.20.0'],
        // ИП без режима: подключённая «ЕНД орг.» ему не подходит, подбирать нечего.
        ['ИП Пусто', '21504202010079', '555 404 406', ' , ', '1000', 'acc-a', '', '69.20.0'],
      ],
      MAP,
    );
    expect(r.rows[0]!.errors).toEqual([]);
    expect(r.rows[0]!.warnings).toHaveLength(1);
    expect(r.rows[0]!.warnings[0]).toMatch(/^Отчёты подобраны автоматически: НДС.*ЕНД орг\.$/);
    expect(r.rows[1]!.errors).toEqual(['нет видов отчётов: укажите их или режим налогообложения']);
  });

  it('«ОК»: создаются только готовые строки — с отчётами, тарифом «Загрузка из Excel», статусами по УГНС и записью в истории; строки с ошибками остаются', async () => {
    const map = [...MAP, 'ugns', 'head', 'contact', 'note', 'sfc', 'form'];
    const r = await applied(
      [
        [
          'ОсОО «Загруженный»',
          '01504202010080',
          '555 404 407',
          'НДС, Соцфонд',
          '15 000,50',
          'acc-a',
          'ОНР',
          '69.20.0',
          'Крупные НП',
          'Иванов И. И.',
          'Пётр',
          'из Excel',
          'Да',
          '',
        ],
        ['ИП Без ГКЭД', '21002199001235', '0700 112 234', 'НДС', '0', 'chief-a', 'ОНР', ''],
        ['ОсОО «Ошибка»', '01504202010081', '555', 'НДС', '0', 'acc-a', 'ОНР', ''],
      ],
      map,
    );
    expect(r.created).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.rows.map((x) => x.errors)).toEqual([[], [], ['неверная длина номера']]);

    const cp = (await byInn('01504202010080'))!;
    expect(cp).toMatchObject({
      name: 'ОсОО «Загруженный»',
      phone: '+996555404407',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '69.20.0',
      taxOfficeCode: 'ugns-large',
      responsibleEmployeeId: f.people['acc-a']!.employeeId,
      head: 'Иванов И. И.',
      contact: 'Пётр',
      note: 'из Excel',
      startDate: '2026-10-01',
      firstMonthMode: 'full',
      feeDay: 10,
      paysTo: 'emp',
    });
    expect(cp.socfundFlags).toEqual({ cashless: true });
    const ip = (await byInn('21002199001235'))!;
    expect(ip).toMatchObject({ formCode: 'ФС-02', gked: null });

    const [tariff] = await f.t.admin.db
      .select()
      .from(schema.contractorTariffs)
      .where(eq(schema.contractorTariffs.contractorId, cp.id));
    expect(tariff).toMatchObject({
      amount: 1_500_050,
      period: 'M',
      validFrom: '2026-10-01',
      note: 'Загрузка из Excel',
    });
    const bases = await f.t.admin.db
      .select({ code: schema.contractorBases.baseCode })
      .from(schema.contractorBases)
      .where(eq(schema.contractorBases.contractorId, cp.id));
    expect(bases.map((b) => b.code)).toEqual(['employees']);
    const benefits = await f.t.admin.db
      .select({ code: schema.contractorBenefits.benefitCode })
      .from(schema.contractorBenefits)
      .where(eq(schema.contractorBenefits.contractorId, cp.id));
    expect(benefits.length).toBeGreaterThan(0);
    const assigned = await f.t.admin.db
      .select({ code: schema.assignments.reportTypeCode })
      .from(schema.assignments)
      .where(eq(schema.assignments.contractorId, cp.id));
    expect(assigned.map((a) => a.code).sort()).toEqual(['nds', 'soc']);
    const reports = await f.t.admin.db
      .select({ id: schema.reports.id })
      .from(schema.reports)
      .where(eq(schema.reports.contractorId, cp.id));
    expect(reports.length).toBeGreaterThan(0);

    const history = await f.t.admin.db
      .select({
        entity: schema.auditLog.entity,
        action: schema.auditLog.action,
        reason: schema.auditLog.reason,
        changes: schema.auditLog.changes,
        actor: schema.auditLog.actorUserId,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.orgId, f.a.orgId));
    expect(
      history.find((h) => h.entity === 'contractor' && h.action === 'create' && h.reason),
    ).toMatchObject({ reason: 'Создан загрузкой из Excel' });
    const imports = history.filter((h) => h.entity === 'contractor_import');
    expect(imports).toEqual([
      {
        entity: 'contractor_import',
        action: 'import',
        reason: null,
        changes: [
          { field: 'created', to: 2 },
          { field: 'skipped', to: 1 },
        ],
        actor: f.a.ownerUserId,
      },
    ]);

    // Повторная загрузка тех же строк: ИНН уже есть в организации — ничего не создаётся, загрузка в истории.
    const again = await applied(
      [['ОсОО «Загруженный»', '01504202010080', '555 404 407', 'НДС', '0', 'acc-a', 'ОНР', '']],
      MAP,
      chief,
    );
    expect(again).toMatchObject({ created: 0, skipped: 1, ready: 0 });
    expect(again.rows[0]!.errors).toEqual(['ИНН уже есть в организации']);
  });

  it('без права видеть плату колонка стоимости не загружается, тарифа нет', async () => {
    const hr = await signIn(f.app, 'hr-a', TEST_PASSWORD);
    const role = await f.t.admin.db
      .select({ id: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, f.roleIds.hr));
    if (!role.some((p) => p.id === 'cpImport')) {
      await f.t.admin.db
        .insert(schema.rolePermissions)
        .values({ orgId: f.a.orgId, roleId: f.roleIds.hr, permissionId: 'cpImport' });
    }
    const r = await applied(
      [['ОсОО «Без платы»', '01504202010082', '555 404 408', 'НДС', 'много', 'acc-a', 'ОНР', '']],
      MAP,
      hr,
    );
    expect(r.created).toBe(1);
    const cp = (await byInn('01504202010082'))!;
    const tariffs = await f.t.admin.db
      .select()
      .from(schema.contractorTariffs)
      .where(eq(schema.contractorTariffs.contractorId, cp.id));
    expect(tariffs).toEqual([]);
  });

  it('область «Свои»: ИНН контрагента вне области — только «ИНН уже есть в организации», без названия', async () => {
    // У «Кадров» область «Свои» и (с прошлого теста) право загрузки; контрагент с этим ИНН закреплён
    // не за ним.
    const hr = await signIn(f.app, 'hr-a', TEST_PASSWORD);
    const foreign = (await byInn('01504202010080'))!;
    expect(foreign.responsibleEmployeeId).not.toBe(f.people['hr-a']!.employeeId);
    const res = await call('/api/contractors/import/check', hr, {
      map: MAP,
      rows: [['ОсОО «Свой»', '01504202010080', '555 404 411', 'НДС', '', 'acc-a', 'ОНР', '']],
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(foreign.name);
    expect(text).not.toContain(foreign.id);
    expect(ContractorImportCheck.parse(JSON.parse(text)).rows[0]!.errors).toEqual([
      'ИНН уже есть в организации',
    ]);
  });

  it('по очереди: идёт прежняя проверка — 429 «ещё идёт», за час уже 60 — 429', async () => {
    const { userId } = f.people['chief-a']!;
    const mine = and(
      eq(schema.rateLimits.kind, CP_IMPORT_RATE_LIMIT.kind),
      eq(schema.rateLimits.subject, userId),
    );
    await f.t.admin.db.delete(schema.rateLimits).where(mine);
    const body = { map: MAP, rows: [['ОсОО «Очередь»']] };
    await f.t.admin.db.insert(schema.rateLimits).values({
      kind: CP_IMPORT_RATE_LIMIT.kind,
      subject: userId,
      busyUntil: new Date(Date.now() + 60_000),
    });
    const busy = await call('/api/contractors/import/check', chief, body);
    expect(busy.status).toBe(429);
    expect((await failure(busy)).code).toBe('cp_import_busy');
    // Другой сотрудник в это время проверяет свою вставку.
    await checked(body.rows);
    await f.t.admin.db.update(schema.rateLimits).set({ busyUntil: null }).where(mine);
    await f.t.admin.db.insert(schema.rateLimits).values(
      Array.from({ length: CP_IMPORT_RATE_LIMIT.max - 1 }, () => ({
        kind: CP_IMPORT_RATE_LIMIT.kind,
        subject: userId,
        at: new Date(Date.now() - 30 * 60_000),
      })),
    );
    const limited = await call('/api/contractors/import', chief, body);
    expect(limited.status).toBe(429);
    expect((await failure(limited)).code).toBe('cp_import_limit');
    await f.t.admin.db.delete(schema.rateLimits).where(mine);
  });

  it('чужая организация не видна: ИНН другой организации свободен, создаётся в своей', async () => {
    const r = await applied(
      [
        [
          'ОсОО «Загруженный Б»',
          '01504202010080',
          '555 404 409',
          'НДС',
          '100',
          'owner-b',
          'ОНР',
          '',
        ],
      ],
      MAP,
      ownerB,
    );
    expect(r.created).toBe(1);
    expect((await byInn('01504202010080', f.b.orgId))!.name).toBe('ОсОО «Загруженный Б»');
    expect((await byInn('01504202010080'))!.name).toBe('ОсОО «Загруженный»');
    // Сотрудник другой организации ответственным не находится.
    const other = await checked(
      [['ОсОО «Чужой»', '01504202010083', '555 404 410', 'НДС', '100', 'acc-a', 'ОНР', '']],
      MAP,
      ownerB,
    );
    expect(other.rows[0]!.errors).toEqual(['сотрудник «acc-a» не найден']);
  });

  it('шаблон: колонки с обязательными и подсказками этой организации, коды ГКЭД; файл .xlsx из трёх листов', async () => {
    const res = await apiRequest(f.app, 'GET', '/api/contractors/import/template/preview', chief);
    expect(res.status, await res.clone().text()).toBe(200);
    const tpl = ContractorImportTemplate.parse(await res.json());
    expect(tpl.columns.map((c) => c.key)).toContain('fee');
    expect(tpl.columns.filter((c) => c.required).map((c) => c.key)).toEqual([
      'name',
      'inn',
      'phone',
      'fee',
      'resp',
    ]);
    const resp = tpl.columns.find((c) => c.key === 'resp')!;
    expect(resp.hint).toMatch(/^логин или ФИО сотрудника: /);
    expect(resp.hint).toContain('acc-a');
    expect(resp.hint).not.toContain('owner-b');
    expect(resp.example).toBe('acc-a');
    expect(tpl.columns.find((c) => c.key === 'types')!.hint).toContain('НДС');
    expect(tpl.columns.find((c) => c.key === 'name')!).toMatchObject({
      title: 'Название',
      example: 'ОсОО «Пример»',
      hint: 'текст',
    });
    expect(tpl.gked.find((g) => g.code === '69.20.0')).toEqual({
      code: '69.20.0',
      name: 'Деятельность в области бухгалтерского учета и аудита',
      section: 'M',
    });
    expect(tpl.gked.every((g) => /^\d\d\.\d\d\.\d$/.test(g.code))).toBe(true);

    const file = await apiRequest(f.app, 'GET', '/api/contractors/import/template', chief);
    expect(file.status, await file.clone().text()).toBe(200);
    expect(file.headers.get('content-type')).toContain('spreadsheetml');
    expect(decodeURIComponent(file.headers.get('content-disposition') ?? '')).toContain(
      'Шаблон загрузки контрагентов.xlsx',
    );
    const rows = readSheetRows(Buffer.from(await file.arrayBuffer()));
    expect(rows[0]![0]).toBe('Название *');
    expect(rows[1]![0]).toBe('ОсОО «Пример»');
    expect(rows[1]![1]).toBe('01234567890123');
  });
});
