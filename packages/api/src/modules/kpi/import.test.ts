import { fixedClock } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { KPI_IMPORT_HOURLY_LIMIT, KPI_MESSAGES } from '@buhuchet/domain';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  Indicators,
  KpiEntry,
  KpiImportApplied,
  KpiImportHistory,
  KpiImportOptions,
  KpiImportPreview,
  KpiImportTemplatePreview,
} from '@buhuchet/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { buildXlsx, type XlsxCell } from '../../lists/xlsx';
import { readXlsxRows } from '../../lists/xlsx-read';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  signIn,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const C3 = '00000000-0000-4000-8000-0000000000c3';
const B1 = '00000000-0000-4000-8000-0000000000d1';
const INN1 = '03744097401851';
const INN2 = '21503199000123';
const INN3 = '02203199000124';

const REVENUE = 'Выручка · 09.2026 (сом, сумма в сом)';
const STAFF = 'Количество сотрудников · 09.2026 (чел., целое число)';

/** Сотые: 1 250 000 сом → 125000000. */
const som = (n: number) => n * 100;

/** Заполненный шаблон: первая строка — заголовки, дальше строки контрагентов. */
const sheet = (rows: XlsxCell[][]) =>
  buildXlsx(
    'Показатели',
    rows[0]!.map((title) => ({ title: String(title), kind: 'text' as const })),
    rows.slice(1),
  );

describe.skipIf(!databaseAvailable())('Показатели контрагентов: ввод из Excel', () => {
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

  const call = (cookie: string | undefined, method: 'GET' | 'POST', path: string, body?: unknown) =>
    apiRequest(app, method, path, cookie, body);
  const upload = (cookie: string | undefined, path: string, file: Uint8Array | string) =>
    app.request(path, {
      method: 'POST',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/octet-stream',
        ...(cookie ? { cookie } : {}),
      },
      body: typeof file === 'string' ? Buffer.from(file, 'utf8') : file,
    });
  const errorOf = async (res: Response) =>
    ((await res.json()) as { error: { code: string; message: string } }).error;
  const preview = async (cookie: string, file: Uint8Array | string) => {
    const res = await upload(cookie, '/api/kpi/import/preview?file=x.xlsx', file);
    expect(res.status).toBe(200);
    return KpiImportPreview.parse(await res.json());
  };
  const apply = (
    cookie: string,
    file: Uint8Array | string,
    withChecked = false,
    name = 'Показатели сентябрь 2026.xlsx',
  ) =>
    upload(
      cookie,
      `/api/kpi/import/apply?file=${encodeURIComponent(name)}&withChecked=${withChecked}`,
      file,
    );
  const tpl = (q: string) => `from=2026-09&to=2026-09&inds=${revenue},${staffCount}${q}`;
  const entry = async (contractorId: string, m = '2026-09', cookie = owner) =>
    KpiEntry.parse(
      await (
        await call(cookie, 'GET', `/api/kpi/entry?contractorId=${contractorId}&month=${m}`)
      ).json(),
    );
  const features = (orgId: string, on: Record<string, boolean>) =>
    f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: sql`${schema.orgSettings.features} || ${JSON.stringify(on)}::jsonb` })
      .where(eq(schema.orgSettings.orgId, orgId));
  const contractor = (id: string, orgId: string, name: string, inn: string) => ({
    id,
    orgId,
    name,
    inn,
    phone: '+996505890076',
    formCode: 'ФС-01',
    regimeCode: 'РЕЖ-01',
    startDate: '2024-07-16',
  });

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    // 24.10.2026 по Бишкеку: идущий месяц — 10.2026, период шаблона по умолчанию — 09.2026.
    app = createApp(createTestDeps({ db: f.t.app.db, clock: fixedClock('2026-10-24T03:00:00Z') }));
    await features(f.a.orgId, { indicators: true });
    const accA = f.people['acc-a']!.employeeId;
    await f.t.admin.db
      .insert(schema.contractors)
      .values([
        { ...contractor(C1, f.a.orgId, 'ОсОО «Укс»', INN1), responsibleEmployeeId: accA },
        contractor(C2, f.a.orgId, 'ИП Асанов', INN2),
        { ...contractor(C3, f.a.orgId, 'ОсОО «Ак-Жол»', INN3), responsibleEmployeeId: accA },
        contractor(B1, f.b.orgId, 'ОсОО «Бета»', '03744097401852'),
      ]);
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
    const list = Indicators.parse(await (await call(owner, 'GET', '/api/kpi/indicators')).json());
    revenue = list.items.find((i) => i.name === 'Выручка')!.id;
    staffCount = list.items.find((i) => i.name === 'Количество сотрудников')!.id;
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('без входа — 401; без права «Вводить показатели из Excel» — 403; функция выключена — 403', async () => {
    const file = await sheet([['ИНН', REVENUE]]);
    expect((await call(undefined, 'GET', '/api/kpi/import/options')).status).toBe(401);
    expect((await upload(undefined, '/api/kpi/import/preview?file=a.xlsx', file)).status).toBe(401);
    for (const cookie of [senior, admin]) {
      expect((await call(cookie, 'GET', '/api/kpi/import/options')).status).toBe(403);
      expect((await call(cookie, 'GET', `/api/kpi/import/template?${tpl('')}`)).status).toBe(403);
      expect(
        (await upload(cookie, '/api/kpi/import/apply?file=a&withChecked=false', file)).status,
      ).toBe(403);
      expect((await call(cookie, 'GET', '/api/kpi/import/history')).status).toBe(403);
    }
    const off = await call(ownerB, 'GET', '/api/kpi/import/history');
    expect(off.status).toBe(403);
    expect((await errorOf(off)).code).toBe('indicators_off');
  });

  it('шаг 1: показатели, ответственные и режимы в области сотрудника; период — прошлый месяц', async () => {
    const all = KpiImportOptions.parse(
      await (await call(owner, 'GET', '/api/kpi/import/options')).json(),
    );
    expect(all.indicators.map((i) => i.name)).toEqual(['Выручка', 'Количество сотрудников']);
    expect([all.defaultMonth, all.currentMonth]).toEqual(['2026-09', '2026-10']);
    expect(all.responsibles.map((r) => r.id)).toEqual([f.people['acc-a']!.employeeId]);
    expect(all.regimes.map((r) => r.code)).toEqual(['РЕЖ-01']);
    const own = KpiImportOptions.parse(
      await (await call(acc, 'GET', '/api/kpi/import/options')).json(),
    );
    expect(own.responsibles).toHaveLength(1);
  });

  it('(п. 45) шаблон бухгалтера: только его контрагенты и ведущиеся показатели, ИНН и названия защищены', async () => {
    const q = await call(acc, 'GET', `/api/kpi/import/template/preview?${tpl('')}`);
    expect(q.status).toBe(200);
    const p = KpiImportTemplatePreview.parse(await q.json());
    expect([p.contractors, p.columns, p.tooMany]).toEqual([2, 2, null]);
    expect(p.rows.map((r) => r.inn)).toEqual([INN3, INN1]);
    expect(p.head.map((h) => h.title)).toEqual([
      'Выручка · 09.2026',
      'Количество сотрудников · 09.2026',
    ]);
    expect(p.head.map((h) => h.unit)).toEqual(['сом, сумма в сом', 'чел., целое число']);

    const res = await call(acc, 'GET', `/api/kpi/import/template?${tpl('')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(
      encodeURIComponent('Показатели сентябрь 2026.xlsx'),
    );
    expect([res.headers.get('x-import-rows'), res.headers.get('x-import-columns')]).toEqual([
      '2',
      '2',
    ]);
    const rows = readXlsxRows(Buffer.from(await res.arrayBuffer()));
    expect(rows).toEqual([
      ['ИНН', 'Контрагент', REVENUE, STAFF],
      [INN3, 'ОсОО «Ак-Жол»'],
      [INN1, 'ОсОО «Укс»'],
    ]);
    // Владелец видит всех; фильтр «Ответственный» и поиск сужают шаблон.
    const all = KpiImportTemplatePreview.parse(
      await (await call(owner, 'GET', `/api/kpi/import/template/preview?${tpl('')}`)).json(),
    );
    expect(all.contractors).toBe(3);
    const found = KpiImportTemplatePreview.parse(
      await (
        await call(owner, 'GET', `/api/kpi/import/template/preview?${tpl('&q=асанов')}`)
      ).json(),
    );
    expect(found.rows.map((r) => r.inn)).toEqual([INN2]);
    const resp = KpiImportTemplatePreview.parse(
      await (
        await call(
          owner,
          'GET',
          `/api/kpi/import/template/preview?${tpl(`&resp=${f.people['acc-a']!.employeeId}`)}`,
        )
      ).json(),
    );
    expect(resp.contractors).toBe(2);
  });

  it('шаблон: больше 24 месяцев, будущий месяц, пусто — отказ с понятной причиной', async () => {
    const long = `from=2024-09&to=2026-09&inds=${revenue}`;
    const p = KpiImportTemplatePreview.parse(
      await (await call(owner, 'GET', `/api/kpi/import/template/preview?${long}`)).json(),
    );
    expect(p.tooMany).toBe('months');
    // Как в прототипе: предупреждение, а числа и первые строки — настоящие.
    expect([p.contractors, p.columns]).toEqual([3, 25]);
    expect(p.rows).toHaveLength(3);
    const tooLong = KpiImportTemplatePreview.parse(
      await (
        await call(
          owner,
          'GET',
          `/api/kpi/import/template/preview?from=2020-01&to=2026-09&inds=${revenue}`,
        )
      ).json(),
    );
    expect([tooLong.tooMany, tooLong.contractors, tooLong.rows]).toEqual(['months', 0, []]);
    const res = await call(owner, 'GET', `/api/kpi/import/template?${long}`);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({
      code: 'import_too_many_months',
      message: 'В одном шаблоне — не больше 24 месяцев. Сократите период.',
    });
    const future = await call(
      owner,
      'GET',
      `/api/kpi/import/template?from=2026-11&to=2026-11&inds=${revenue}`,
    );
    expect((await errorOf(future)).code).toBe('month_in_future');
    const empty = await call(
      owner,
      'GET',
      '/api/kpi/import/template?from=2026-09&to=2026-09&inds=',
    );
    expect((await errorOf(empty)).code).toBe('import_empty');
    const bad = await call(owner, 'GET', '/api/kpi/import/template?from=2026-9&to=2026-09&inds=x');
    expect(bad.status).toBe(400);
  });

  it('(п. 45) «abc» в ячейке — ошибка с номером строки; остальные строки применяются, в истории «Из Excel»', async () => {
    const file = await sheet([
      ['ИНН', 'Контрагент', REVENUE, STAFF],
      [INN1, 'ОсОО «Укс»', '1 250 000,50', 12],
      [INN3, 'ОсОО «Ак-Жол»', 900_000, 'abc'],
      [INN2, 'ИП Асанов', 100, null],
      ['99999999999999', 'Неизвестный', 1, null],
    ]);
    const p = await preview(acc, file);
    expect([p.added, p.changed, p.same, p.errorCount, p.skipped]).toEqual([2, 0, 0, 3, 1]);
    expect(p.errors).toEqual([
      {
        ref: 'D3',
        row: 3,
        col: 'D',
        contractor: 'ОсОО «Ак-Жол»',
        value: 'abc',
        problem: 'not_number',
      },
      // Контрагент не бухгалтера: нет ни его названия, ни значений.
      { ref: 'A4', row: 4, col: 'A', contractor: null, value: INN2, problem: 'no_access' },
      {
        ref: 'A5',
        row: 5,
        col: 'A',
        contractor: null,
        value: '99999999999999',
        problem: 'unknown_contractor',
      },
    ]);
    expect(p.addedItems.map((x) => [x.ref, x.contractor, x.indicator, x.value])).toEqual([
      ['C2', 'ОсОО «Укс»', 'Выручка', 125_000_050],
      ['D2', 'ОсОО «Укс»', 'Количество сотрудников', 1200],
    ]);

    const res = await apply(acc, file);
    expect(res.status).toBe(200);
    const done = KpiImportApplied.parse(await res.json());
    expect(done.record).toMatchObject({
      fileName: 'Показатели сентябрь 2026.xlsx',
      from: '2026-09',
      to: '2026-09',
      added: 2,
      changed: 0,
      errors: 3,
      skippedChecked: 0,
      actor: expect.any(String),
    });
    const e1 = await entry(C1);
    expect(e1.items.find((i) => i.indicator.id === revenue)!.value).toBe(125_000_050);
    expect(e1.status?.code).toBe('filled');
    expect(e1.history.map((h) => [h.to, h.reason])).toEqual(
      expect.arrayContaining([
        [125_000_050, 'xlsx'],
        [1200, 'xlsx'],
      ]),
    );
    // Строка с «abc» не записана целиком.
    expect((await entry(C3)).items.every((i) => i.value === null)).toBe(true);
    // Запись истории изменений — шаг «Базы знаний» «Ввести показатели из Excel».
    const [log] = await f.t.admin.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.entity, 'indicator_import'),
          eq(schema.auditLog.entityId, done.record.id),
        ),
      );
    expect(log).toMatchObject({ action: 'create', actorUserId: f.people['acc-a']!.userId });

    const history = KpiImportHistory.parse(
      await (await call(acc, 'GET', '/api/kpi/import/history')).json(),
    );
    expect(history.items.map((r) => r.id)).toEqual([done.record.id]);
  });

  it('повторная загрузка — «Без изменений»; применять нечего — отказ', async () => {
    const file = await sheet([
      ['ИНН', 'Контрагент', REVENUE],
      // Excel убрал ведущий ноль у ИНН-числа — контрагент всё равно найден.
      [Number(INN1), 'ОсОО «Укс»', 1_250_000.5],
    ]);
    const p = await preview(acc, file);
    expect([p.added, p.changed, p.same, p.errorCount]).toEqual([0, 0, 1, 0]);
    const res = await apply(acc, file);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('import_nothing');
  });

  it('проверенный месяц: изменение — только с согласия, иначе пропускается; с согласием месяц снова «Заполнено»', async () => {
    const status = (await entry(C1)).status!;
    const check = await call(chief, 'POST', '/api/kpi/months/check', {
      contractorId: C1,
      month: '2026-09',
      version: status.version,
    });
    expect(check.status).toBe(200);
    expect((await entry(C1)).status!.code).toBe('checked');
    // CSV из Excel: «;» и Windows-1251 не нужны — UTF-8 с BOM.
    const csv = `\ufeffИНН;Контрагент;${REVENUE}\r\n${INN1};ОсОО «Укс»;1 300 000\r\n`;
    const p = await preview(acc, csv);
    expect([p.changed, p.changedChecked]).toEqual([1, 1]);
    expect(p.changedItems[0]).toMatchObject({
      old: 125_000_050,
      value: som(1_300_000),
      checked: true,
    });

    const without = KpiImportApplied.parse(await (await apply(acc, csv, false)).json());
    expect(without.record).toMatchObject({ added: 0, changed: 0, skippedChecked: 1 });
    expect((await entry(C1)).items.find((i) => i.indicator.id === revenue)!.value).toBe(
      125_000_050,
    );

    const withChecked = KpiImportApplied.parse(await (await apply(acc, csv, true)).json());
    expect(withChecked.record).toMatchObject({ added: 0, changed: 1, skippedChecked: 0 });
    const after = await entry(C1);
    expect(after.items.find((i) => i.indicator.id === revenue)!.value).toBe(som(1_300_000));
    expect(after.status!.code).toBe('filled');

    const history = KpiImportHistory.parse(
      await (await call(owner, 'GET', '/api/kpi/import/history')).json(),
    );
    expect(history.items.map((r) => [r.changed, r.skippedChecked])).toEqual([
      [1, 0],
      [0, 1],
      [0, 0],
    ]);
  });

  it('ошибки — файлом .xlsx: ячейка, строка, столбец, контрагент, значение, причина словами', async () => {
    const file = await sheet([
      ['ИНН', 'Контрагент', REVENUE, 'Прибыль · 09.2026', 'Выручка · 11.2026'],
      [INN3, 'ОсОО «Ак-Жол»', 'abc', null, 5],
    ]);
    const res = await upload(acc, '/api/kpi/import/errors?file=x.xlsx', file);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(
      encodeURIComponent('Ошибки загрузки показателей.xlsx'),
    );
    expect(readXlsxRows(Buffer.from(await res.arrayBuffer()))).toEqual([
      ['Ячейка', 'Строка', 'Столбец', 'Контрагент', 'Значение', 'Причина'],
      ['D1', 1, 'D', null, 'Прибыль · 09.2026', 'неизвестный показатель'],
      ['C2', 2, 'C', 'ОсОО «Ак-Жол»', 'abc', 'не число'],
      ['E2', 2, 'E', 'ОсОО «Ак-Жол»', '5', 'месяц ещё не наступил'],
    ]);
  });

  it('не таблица, нет столбца «ИНН», файл больше 4 МБ — понятный отказ', async () => {
    const garbage = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
    const unreadable = await upload(acc, '/api/kpi/import/preview?file=a.xlsx', garbage);
    expect(unreadable.status).toBe(400);
    expect((await errorOf(unreadable)).code).toBe('import_file_unreadable');
    const empty = await upload(acc, '/api/kpi/import/preview?file=a.xlsx', '');
    expect((await errorOf(empty)).code).toBe('import_file_unreadable');
    // Строк больше предела листа (в шаблоне — до 1 000 контрагентов) — 400, файл не разбирается.
    const tall = await upload(acc, '/api/kpi/import/preview?file=a.csv', 'ИНН\n'.repeat(5_001));
    expect(tall.status).toBe(400);
    expect(await errorOf(tall)).toMatchObject({
      code: 'import_sheet_too_big',
      message: KPI_MESSAGES.import_sheet_too_big,
    });
    const noInn = await preview(acc, `Контрагент;${REVENUE}\r\nОсОО «Укс»;1\r\n`);
    expect(noInn.errors).toEqual([
      { ref: 'A1', row: 1, col: 'A', contractor: null, value: '', problem: 'no_inn' },
    ]);
    const big = await upload(
      acc,
      '/api/kpi/import/preview?file=a.csv',
      'x'.repeat(4 * 1024 * 1024 + 1),
    );
    expect(big.status).toBe(413);
    expect(await errorOf(big)).toMatchObject({
      code: 'import_file_too_big',
      message: 'Файл больше 4 МБ',
    });
    const noName = await upload(acc, '/api/kpi/import/apply?withChecked=false', '');
    expect(noName.status).toBe(400);
  });

  it('чужая организация: контрагент по ИНН не найден, история загрузок пуста', async () => {
    await features(f.b.orgId, { indicators: true });
    const file = await sheet([
      ['ИНН', 'Контрагент', REVENUE],
      [INN1, 'ОсОО «Укс»', 1],
    ]);
    const p = await preview(ownerB, file);
    expect(p.errors.map((e) => [e.ref, e.problem, e.contractor])).toEqual([
      ['A2', 'unknown_contractor', null],
    ]);
    expect(
      KpiImportHistory.parse(await (await call(ownerB, 'GET', '/api/kpi/import/history')).json())
        .items,
    ).toEqual([]);
  });

  it('разбор файла по очереди: идёт прежний — 429 «ещё разбирается», за час уже 60 — 429', async () => {
    const { userId } = f.people['acc-a']!;
    const mine = and(
      eq(schema.rateLimits.kind, 'kpi_import'),
      eq(schema.rateLimits.subject, userId),
    );
    await f.t.admin.db.delete(schema.rateLimits).where(mine);
    const file = `ИНН;${REVENUE}\r\n${INN1};1\r\n`;
    await f.t.admin.db.insert(schema.rateLimits).values({
      kind: 'kpi_import',
      subject: userId,
      busyUntil: new Date(Date.now() + 60_000),
    });
    const busy = await upload(acc, '/api/kpi/import/preview?file=a.csv', file);
    expect(busy.status).toBe(429);
    expect(await errorOf(busy)).toEqual({
      code: 'import_busy',
      message: KPI_MESSAGES.import_busy,
    });
    // Другой сотрудник в это время разбирает свой файл.
    await preview(owner, file);
    await f.t.admin.db.update(schema.rateLimits).set({ busyUntil: null }).where(mine);
    // Отказ «ещё разбирается» в счёт не идёт: за час — прежний разбор, этот и ещё 58.
    await preview(acc, file);
    await f.t.admin.db.insert(schema.rateLimits).values(
      Array.from({ length: KPI_IMPORT_HOURLY_LIMIT - 2 }, () => ({
        kind: 'kpi_import',
        subject: userId,
        at: new Date(Date.now() - 30 * 60_000),
      })),
    );
    const limited = await apply(acc, file);
    expect(limited.status).toBe(429);
    expect(await errorOf(limited)).toEqual({
      code: 'import_limit',
      message: KPI_MESSAGES.import_limit,
    });
    await f.t.admin.db.delete(schema.rateLimits).where(mine);
  });
});
