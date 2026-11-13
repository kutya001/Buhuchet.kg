import { schema } from '@buhuchet/db';
import { databaseAvailable, seedPlatformDictionaries } from '@buhuchet/db/testing';
import { OrgReportTypesBulkResult, OrgReportTypeSettings } from '@buhuchet/shared';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

// Прототип v84 (modules/dicts.js: typesBulkOn, typesBulkDlg), docs/deviations.md п. О-74.
describe.skipIf(!databaseAvailable())('«Виды отчётов»: массовые изменения (прототип v84)', () => {
  let f: Fixture;
  let owner: string;
  let acc: string;
  let ownerB: string;

  const bulk = (cookie: string, body: Record<string, unknown>) =>
    apiRequest(f.app, 'POST', '/api/org-report-types/bulk', cookie, body);
  const done = async (cookie: string, body: Record<string, unknown>) => {
    const res = await bulk(cookie, body);
    expect(res.status, await res.clone().text()).toBe(200);
    return OrgReportTypesBulkResult.parse(await res.json());
  };
  const byCode = async (cookie: string) => {
    const res = await apiRequest(f.app, 'GET', '/api/org-report-types/settings', cookie);
    const items = OrgReportTypeSettings.parse(await res.json()).items;
    return Object.fromEntries(items.map((s) => [s.code, s]));
  };
  const errorCode = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;
  /** Записи истории вида: действие и изменённые поля. */
  const history = async (code: string) => {
    const rows = await f.t.admin.db
      .select({ action: schema.auditLog.action, changes: schema.auditLog.changes })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.orgId, f.a.orgId),
          eq(schema.auditLog.entity, 'org_report_type'),
          eq(schema.auditLog.entityId, code),
        ),
      )
      .orderBy(asc(schema.auditLog.at));
    return rows.map((r) => ({
      action: r.action,
      fields: (r.changes as { field: string }[]).map((c) => c.field).sort(),
    }));
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedPlatformDictionaries(f.t.admin.db);
    [owner, acc, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('только право «Вести справочники организации»; без входа — 401; неверные данные — 400; нет вида — 404', async () => {
    expect((await bulk(acc, { action: 'connect', codes: ['nds'] })).status).toBe(403);
    expect((await bulk('', { action: 'connect', codes: ['nds'] })).status).toBe(401);
    expect((await bulk(owner, { action: 'connect', codes: [] })).status).toBe(400);
    expect((await bulk(owner, { action: 'archive', codes: ['nds'] })).status).toBe(400);
    // Настройки — только у «Настроить»; пустое окно; дни от 1 до 60.
    const extra = await bulk(owner, { action: 'connect', codes: ['nds'], needFile: true });
    expect([extra.status, await errorCode(extra)]).toEqual([400, 'validation_failed']);
    const empty = await bulk(owner, { action: 'setup', codes: ['nds'] });
    expect([empty.status, await errorCode(empty)]).toEqual([400, 'types_bulk_empty']);
    const days = await bulk(owner, { action: 'setup', codes: ['nds'], remindDays: [61] });
    expect([days.status, await errorCode(days)]).toEqual([400, 'remind_days_invalid']);
    const unknown = await bulk(owner, { action: 'connect', codes: ['nds', 'no-such'] });
    expect(unknown.status).toBe(404);
    expect(await byCode(owner)).toEqual({});
  });

  it('«Подключить»: новые — с днями учётной политики, подключённые и отключённые в каталоге пропускаются', async () => {
    expect(await done(owner, { action: 'connect', codes: ['nds', 'soc', 'nds', 'pvt'] })).toEqual({
      total: 3,
      changed: 2,
      busy: 0,
    });
    const now = await byCode(owner);
    expect(now.nds).toMatchObject({
      enabled: true,
      remindDays: [7, 3],
      needFile: false,
      needReceipt: false,
      version: 1,
    });
    expect(now.soc).toMatchObject({ enabled: true, version: 1 });
    expect(now.pvt).toBeUndefined();
    // Повтор ничего не меняет и в историю не пишет.
    expect(await done(owner, { action: 'connect', codes: ['nds', 'soc'] })).toMatchObject({
      changed: 0,
    });
    expect(await history('nds')).toEqual([
      { action: 'create', fields: ['enabled', 'needFile', 'needReceipt', 'remindDays'] },
    ]);
  });

  it('«Настроить»: меняет только отличия, «Файл при сдаче» у вида «только оплата» не ставит, в истории — пометка «массовое изменение»', async () => {
    // pat — «Уплата»; endo ещё не подключён.
    await done(owner, { action: 'connect', codes: ['pat'] });
    const res = await done(owner, {
      action: 'setup',
      codes: ['nds', 'soc', 'pat', 'endo'],
      needFile: true,
      needReceipt: true,
      remindDays: [5, 1, 5],
      connect: false,
    });
    expect(res).toEqual({ total: 4, changed: 3, busy: 0 });
    const now = await byCode(owner);
    expect(now.nds).toMatchObject({
      needFile: true,
      needReceipt: true,
      remindDays: [5, 1],
      version: 2,
    });
    expect(now.pat).toMatchObject({ needFile: false, needReceipt: true, remindDays: [5, 1] });
    expect(now.endo).toBeUndefined();
    expect((await history('nds')).at(-1)).toEqual({
      action: 'update',
      fields: ['bulk', 'needFile', 'needReceipt', 'remindDays'],
    });
    expect((await history('pat')).at(-1)).toEqual({
      action: 'update',
      fields: ['bulk', 'needReceipt', 'remindDays'],
    });
    // Всё уже так — «Изменений нет»: версия и история прежние.
    expect(
      await done(owner, { action: 'setup', codes: ['nds', 'pat'], needFile: true, connect: false }),
    ).toEqual({ total: 2, changed: 0, busy: 0 });
    expect((await byCode(owner)).nds!.version).toBe(2);
    expect(await history('nds')).toHaveLength(2);
  });

  it('«Настроить» с «Подключить неподключённые»: новый вид подключается сразу с настройками', async () => {
    const res = await done(owner, {
      action: 'setup',
      codes: ['endo', 'nds'],
      needReceipt: true,
      connect: true,
    });
    expect(res).toEqual({ total: 2, changed: 1, busy: 0 });
    expect((await byCode(owner)).endo).toMatchObject({
      enabled: true,
      remindDays: [7, 3],
      needFile: false,
      needReceipt: true,
      version: 1,
    });
    expect(await history('endo')).toEqual([
      { action: 'create', fields: ['bulk', 'enabled', 'needFile', 'needReceipt', 'remindDays'] },
    ]);
    // Только галочка «Подключить неподключённые», без настроек: вид подключается как есть.
    expect(await done(owner, { action: 'setup', codes: ['tbo'], connect: true })).toMatchObject({
      changed: 1,
    });
    expect((await byCode(owner)).tbo).toMatchObject({ enabled: true, needReceipt: false });
  });

  it('«Отключить»: назначенный действующим контрагентам вид остаётся подключённым, остальные отключаются с сохранением настроек', async () => {
    const [cp] = await f.t.admin.db
      .insert(schema.contractors)
      .values({
        orgId: f.a.orgId,
        name: 'ОсОО «Ала-Тоо»',
        inn: '03744097400001',
        phone: '+996505890076',
        formCode: 'ФС-01',
        startDate: '2026-01-15',
      })
      .returning({ id: schema.contractors.id });
    await f.t.admin.db.insert(schema.assignments).values({
      orgId: f.a.orgId,
      contractorId: cp!.id,
      reportTypeCode: 'nds',
      fromMonth: '2026-10-01',
    });
    expect(
      await done(owner, { action: 'disconnect', codes: ['nds', 'soc', 'pat', 'akc'] }),
    ).toEqual({ total: 4, changed: 2, busy: 1 });
    const now = await byCode(owner);
    expect(now.nds).toMatchObject({ enabled: true });
    expect(now.soc).toMatchObject({ enabled: false, needReceipt: true, remindDays: [5, 1] });
    expect(now.pat).toMatchObject({ enabled: false });
    expect((await history('soc')).at(-1)).toEqual({ action: 'update', fields: ['enabled'] });
    // «Подключить» возвращает отключённый вид с прежними настройками.
    expect(await done(owner, { action: 'connect', codes: ['soc'] })).toMatchObject({ changed: 1 });
    expect((await byCode(owner)).soc).toMatchObject({
      enabled: true,
      needReceipt: true,
      remindDays: [5, 1],
    });
  });

  it('«Настроить» с «Подключить неподключённые» возвращает отключённый вид: настройки прежние, поверх — выбранное, в истории — пометка', async () => {
    // pat отключён предыдущим тестом, настройки сохранены: квитанция — да, дни — 5 и 1.
    expect((await byCode(owner)).pat).toMatchObject({ enabled: false, needReceipt: true });
    // Без галочки отключённый вид не трогается.
    expect(
      await done(owner, { action: 'setup', codes: ['pat'], needReceipt: false, connect: false }),
    ).toEqual({ total: 1, changed: 0, busy: 0 });
    expect(
      await done(owner, { action: 'setup', codes: ['pat'], remindDays: [10], connect: true }),
    ).toEqual({ total: 1, changed: 1, busy: 0 });
    expect((await byCode(owner)).pat).toMatchObject({
      enabled: true,
      needFile: false,
      needReceipt: true,
      remindDays: [10],
    });
    expect((await history('pat')).at(-1)).toEqual({
      action: 'update',
      fields: ['bulk', 'enabled', 'remindDays'],
    });
  });

  it('два одновременных действия с теми же видами в разном порядке: без взаимной блокировки, каждый вид подключён один раз', async () => {
    const codes = ['bal', 'patw', 'akc', 'tbo', 'endo'];
    await done(owner, { action: 'disconnect', codes: ['akc', 'tbo', 'endo'] });
    const before = Object.keys(await byCode(owner));
    const fresh = codes.filter((code) => !before.includes(code));
    expect(fresh.length).toBeGreaterThanOrEqual(2);
    const answers = await Promise.all([
      bulk(owner, { action: 'connect', codes }),
      bulk(owner, { action: 'connect', codes: [...codes].reverse() }),
      bulk(owner, { action: 'setup', codes, needReceipt: true, connect: true }),
    ]);
    // Опоздавший получает «запись изменена другим пользователем», а не ошибку сервера.
    for (const res of answers) expect([200, 409]).toContain(res.status);
    expect(answers.some((res) => res.status === 200)).toBe(true);
    const now = await byCode(owner);
    for (const code of codes) expect(now[code], code).toMatchObject({ enabled: true });
    // Новые строки — по одной на вид, без дублей.
    expect(Object.keys(now).sort()).toEqual([...before, ...fresh].sort());
    for (const code of fresh) {
      expect((await history(code)).filter((h) => h.action === 'create')).toHaveLength(1);
    }
  });

  it('чужая организация не видна: виды организации А у организации Б не меняются', async () => {
    expect(await byCode(ownerB)).toEqual({});
    expect(
      await done(ownerB, {
        action: 'setup',
        codes: ['nds', 'soc'],
        needFile: false,
        connect: false,
      }),
    ).toEqual({ total: 2, changed: 0, busy: 0 });
    expect(await done(ownerB, { action: 'disconnect', codes: ['nds'] })).toMatchObject({
      changed: 0,
    });
    expect(await done(ownerB, { action: 'connect', codes: ['nds'] })).toMatchObject({ changed: 1 });
    expect((await byCode(ownerB)).nds).toMatchObject({
      enabled: true,
      needFile: false,
      version: 1,
    });
    expect((await byCode(owner)).nds).toMatchObject({ enabled: true, needFile: true, version: 2 });
  });

  it('администратор платформы — не сотрудник организации: 403', async () => {
    const admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    expect((await bulk(admin, { action: 'connect', codes: ['nds'] })).status).toBe(403);
  });
});
