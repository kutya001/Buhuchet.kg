import { schema } from '@buhuchet/db';
import { databaseAvailable, seedPlatformDictionaries, seedTaxes } from '@buhuchet/db/testing';
import {
  OrgReportTypeList,
  OrgReportTypeSetting,
  OrgReportTypeSettings,
  OrgReportTypesConnected,
  Taxes,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Справочники → «Виды отчётов» организации', () => {
  let f: Fixture;
  let owner: string;
  let acc: string;
  let chief: string;
  let ownerB: string;
  let active = 0;

  const save = (cookie: string, code: string, body: Record<string, unknown>) =>
    apiRequest(f.app, 'PUT', `/api/org-report-types/${code}`, cookie, body);
  const settings = async (cookie: string) =>
    OrgReportTypeSettings.parse(
      await (await apiRequest(f.app, 'GET', '/api/org-report-types/settings', cookie)).json(),
    );
  const errorCode = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedPlatformDictionaries(f.t.admin.db);
    active = (
      await f.t.admin.db
        .select()
        .from(schema.reportTypes)
        .where(eq(schema.reportTypes.active, true))
    ).length;
    [owner, acc, chief, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('список видят все сотрудники; подключает и настраивает только право «Вести справочники»', async () => {
    const res = await apiRequest(f.app, 'GET', '/api/org-report-types?size=all', acc);
    expect(res.status).toBe(200);
    const list = OrgReportTypeList.parse(await res.json());
    expect(list.total).toBe(active);
    expect(list.items.every((r) => !r.enabled && r.version === null)).toBe(true);
    expect((await save(acc, 'nds', { enabled: true, version: null })).status).toBe(403);
    const connect = await apiRequest(f.app, 'POST', '/api/org-report-types/connect', acc, {
      connect: ['nds'],
      disconnect: [],
    });
    expect(connect.status).toBe(403);
    expect((await settings(acc)).items).toEqual([]);
  });

  it('первое подключение — дни из учётной политики, файл и квитанция выключены; правка — с версией', async () => {
    const res = await save(owner, 'nds', { enabled: true, version: null });
    expect(res.status).toBe(200);
    expect(OrgReportTypeSetting.parse(await res.json())).toEqual({
      code: 'nds',
      enabled: true,
      remindDays: [7, 3],
      needFile: false,
      needReceipt: false,
      version: 1,
    });
    // Пока окно было открыто, вид подключил другой сотрудник.
    const stale = await save(chief, 'nds', { enabled: true, version: null });
    expect(stale.status).toBe(409);
    expect(await errorCode(stale)).toBe('record_changed');
    const changed = await save(chief, 'nds', {
      needFile: true,
      remindDays: [3, 14, 3],
      version: 1,
    });
    expect(OrgReportTypeSetting.parse(await changed.json())).toMatchObject({
      needFile: true,
      remindDays: [14, 3],
      version: 2,
    });
    const list = OrgReportTypeList.parse(
      await (await apiRequest(f.app, 'GET', '/api/org-report-types', acc)).json(),
    );
    expect(list.items[0]).toMatchObject({
      code: 'nds',
      enabled: true,
      remindDays: [14, 3],
      due: 'до 25-го числа месяца после отчётного',
      audit: { createdBy: 'owner-a В.', updatedBy: 'chief-a' },
    });
  });

  it('правила: отключённый в каталоге вид, вид «Уплата», неподключённый вид, неверные дни', async () => {
    const inactive = await save(owner, 'pvt', { enabled: true, version: null });
    expect([inactive.status, await errorCode(inactive)]).toEqual([409, 'report_type_inactive']);
    const unknown = await save(owner, 'no-such', { enabled: true, version: null });
    expect(unknown.status).toBe(404);
    const notConnected = await save(owner, 'soc', { needReceipt: true, version: null });
    expect([notConnected.status, await errorCode(notConnected)]).toEqual([
      409,
      'report_type_not_connected',
    ]);
    await save(owner, 'pat', { enabled: true, version: null });
    const payFile = await save(owner, 'pat', { needFile: true, version: 1 });
    expect([payFile.status, await errorCode(payFile)]).toEqual([400, 'need_file_pay']);
    const days = await save(owner, 'pat', { remindDays: [0], version: 1 });
    expect([days.status, await errorCode(days)]).toEqual([400, 'remind_days_invalid']);
  });

  it('«Выбор налогов»: подключает отмеченные с заданными днями, отключает снятые, одной транзакцией', async () => {
    const res = await apiRequest(f.app, 'POST', '/api/org-report-types/connect', owner, {
      connect: ['soc', 'endo', 'nds'],
      disconnect: ['pat'],
      remindDays: [5, 10],
    });
    expect(OrgReportTypesConnected.parse(await res.json())).toEqual({
      connected: 2,
      disconnected: 1,
    });
    const all = await settings(owner);
    const byCode = Object.fromEntries(all.items.map((s) => [s.code, s]));
    expect(byCode.soc).toMatchObject({ enabled: true, remindDays: [10, 5] });
    // Уже подключённый вид не трогается: дни НДС остались свои.
    expect(byCode.nds).toMatchObject({ enabled: true, remindDays: [14, 3] });
    expect(byCode.pat).toMatchObject({ enabled: false });
    expect(all.remindDays).toEqual([7, 3]);

    const both = await apiRequest(f.app, 'POST', '/api/org-report-types/connect', owner, {
      connect: ['nds'],
      disconnect: ['nds'],
    });
    expect(both.status).toBe(400);
    const inactive = await apiRequest(f.app, 'POST', '/api/org-report-types/connect', owner, {
      connect: ['tbo', 'pvt'],
      disconnect: [],
    });
    expect(inactive.status).toBe(409);
    // Отказ откатывает всё: «tbo» из того же запроса не подключён.
    expect((await settings(owner)).items.some((s) => s.code === 'tbo')).toBe(false);
  });

  it('чужая организация не видна: у организации Б своих подключённых видов нет', async () => {
    expect((await settings(ownerB)).items).toEqual([]);
    const list = OrgReportTypeList.parse(
      await (
        await apiRequest(
          f.app,
          'GET',
          `/api/org-report-types?filters=${encodeURIComponent('{"on":{"type":"enum","vals":["yes"]}}')}`,
          ownerB,
        )
      ).json(),
    );
    expect(list.items.filter((r) => r.enabled)).toEqual([]);
    const own = await save(ownerB, 'nds', { needFile: true, version: 2 });
    expect(own.status).toBe(409);
  });

  it('значения для фильтра и выгрузка в Excel', async () => {
    const values = (await (
      await apiRequest(f.app, 'GET', '/api/org-report-types/values?col=act', acc)
    ).json()) as { items: { value: string; label: string }[] };
    expect(values.items.map((v) => v.label)).toEqual(['Сдача', 'Сдача + уплата', 'Уплата']);
    expect(
      (await apiRequest(f.app, 'GET', '/api/org-report-types/values?col=nope', acc)).status,
    ).toBe(400);
    const file = await apiRequest(f.app, 'GET', '/api/org-report-types/export?cols=name,on', acc);
    expect(file.status).toBe(200);
    const sheet = unzipTexts(new Uint8Array(await file.arrayBuffer()))['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('Подключён');
  });

  it('«Налоги и ставки» для формы просмотра вида — любому вошедшему', async () => {
    await seedTaxes(f.t.admin.db);
    const res = await apiRequest(f.app, 'GET', '/api/taxes', acc);
    const taxes = Taxes.parse(await res.json());
    expect(taxes.items.length).toBeGreaterThan(20);
    expect(taxes.items.find((x) => x.guide.reportTypes.includes('nds'))?.name).toBe(
      'НДС на облагаемые поставки',
    );
    // Названия кодов ГКЭД из связей: ГКЭД в этом тесте не загружен — названий нет, ответ всё равно есть.
    expect(taxes.gkedNames).toEqual({});
    expect((await apiRequest(f.app, 'GET', '/api/taxes?all=yes', acc)).status).toBe(400);
  });
});
