import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withOrgContext } from './context';
import { hashPassword, verifyPassword } from '@buhuchet/adapters/password';
import { eq } from 'drizzle-orm';
import {
  banks,
  dictChangeRequests,
  employees,
  gkedItems,
  loginAttempts,
  organizations,
  passwordResetCodes,
  platformReference,
  reportTypes,
  roles,
  sessions,
  taskCategories,
  telegramLinks,
  telegramOutbox,
  users,
} from './schema';
import {
  checksumOf,
  DEMO_ORG_ID,
  demoId,
  referenceSections,
  seedAll,
  seedPermissions,
  seedPlatformReference,
  TABLE_SECTIONS,
} from './seed';
import { readSpecJson } from './spec-data';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

describe('checksumOf', () => {
  it('не зависит от порядка ключей', () => {
    expect(checksumOf({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      checksumOf({ b: [1, { d: 3, c: 2 }], a: 1 }),
    );
    expect(checksumOf({ a: 1 })).not.toBe(checksumOf({ a: 2 }));
  });
});

describe.skipIf(!databaseAvailable())('начальное наполнение из spec/data', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase();
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('заливает справочники платформы, ГКЭД и демо-организацию', async () => {
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    const gked = await readSpecJson<{ items: unknown[] }>('data/gkedDB.json');
    const result = await seedAll(t.admin.db, { update: false, demo: true });
    expect(result.platformReference.inserted).toBe(Object.keys(referenceSections(refDB)).length);
    expect(result.platformDicts.reportTypes.inserted).toBe((refDB.reportTypes as unknown[]).length);
    expect(result.gked.inserted).toBe(gked.items.length);
    expect(result.demo).toEqual({ orgId: DEMO_ORG_ID, created: true, employees: 7 });
    expect(result.permissions.inserted).toBe(40);
    expect(result.roleTemplates.inserted).toBe(2);
    expect(result.uiTexts.inserted).toBeGreaterThan(0);

    // Разделы со своими таблицами в platform_reference не копируются; у `dictionaries` справочников без
    // своей таблицы не осталось (категории задач — с задачи 2.23).
    const keys = (await t.admin.db.select().from(platformReference)).map((r) => r.key);
    for (const key of TABLE_SECTIONS) expect(keys).not.toContain(key);
    const [dictionaries] = await t.admin.db
      .select()
      .from(platformReference)
      .where(sql`${platformReference.key} = 'dictionaries'`);
    expect(Object.keys(dictionaries!.payload as object).sort()).toEqual([]);
    expect(await t.admin.db.$count(reportTypes)).toBe((refDB.reportTypes as unknown[]).length);
    expect(await t.admin.db.$count(banks)).toBe(
      (refDB.dictionaries as { banks: { items: unknown[] } }).banks.items.length,
    );
    expect(await t.admin.db.$count(taskCategories)).toBe(
      (refDB.dictionaries as { cats: { items: unknown[] } }).cats.items.length,
    );
    expect(
      await t.admin.db.$count(gkedItems, sql`${gkedItems.level} = 'subclass'`),
    ).toBeGreaterThan(0);

    // Статистика всех таблиц собрана сразу после наполнения (п. О-52): у таблицы, которую ещё ни разу
    // не анализировали, reltuples = -1, и планировщик гадает о её размере.
    const unanalyzed = await t.admin.db.execute<{ relname: string }>(
      sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.reltuples < 0 order by 1`,
    );
    expect(unanalyzed.map((r) => r.relname)).toEqual([]);
  });

  it('повторный запуск ничего не дублирует и не меняет', async () => {
    const result = await seedAll(t.admin.db, { update: true, demo: true });
    expect(result.platformReference).toMatchObject({ inserted: 0, updated: 0, removed: 0 });
    for (const report of Object.values(result.platformDicts))
      expect(report).toMatchObject({ inserted: 0, updated: 0 });
    expect(result.gked).toMatchObject({ inserted: 0, updated: 0 });
    expect(result.permissions).toEqual({ inserted: 0, updated: 0, unchanged: 40 });
    expect(result.roleTemplates).toEqual({ inserted: 0, updated: 0, unchanged: 2 });
    expect(result.uiTexts).toMatchObject({ inserted: 0, updated: 0 });
    expect(result.demo).toMatchObject({ created: false, employees: 0 });
  });

  it('изменённый раздел обновляется только с --update и повышает версию', async () => {
    const changed = { taxRates: { nds: ['12 %'] } };
    const quiet = await seedPlatformReference(t.admin.db, changed, 'test', { update: false });
    expect(quiet).toEqual({ inserted: 0, updated: 0, unchanged: 1, removed: 0 });
    const loud = await seedPlatformReference(t.admin.db, changed, 'test', { update: true });
    expect(loud.updated).toBe(1);
    const [row] = await t.admin.db
      .select()
      .from(platformReference)
      .where(sql`${platformReference.key} = 'taxRates'`);
    expect(row?.version).toBe(2);
    expect(row?.source).toBe('test');
  });

  it('с --update удаляются копии разделов, переехавших в свои таблицы (наполнение этапа 0)', async () => {
    await t.admin.db
      .insert(platformReference)
      .values({ key: 'reportTypes', payload: [], checksum: 'x', source: 'этап 0' });
    const quiet = await seedPlatformReference(t.admin.db, {}, 'test', { update: false });
    expect(quiet.removed).toBe(0);
    const loud = await seedPlatformReference(t.admin.db, {}, 'test', { update: true });
    expect(loud.removed).toBe(1);
    expect(
      await t.admin.db.$count(platformReference, sql`${platformReference.key} = 'reportTypes'`),
    ).toBe(0);
  });

  it('с --update из наполнения этапа 1 уходят копии ставок ЕН, форм собственности и причин (задача 2.01)', async () => {
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    const dicts = refDB.dictionaries as Record<string, unknown>;
    // Как на стенде до 2.01: ставки ЕН — своим разделом, формы, причины и банки (до 2.18) — внутри
    // `dictionaries`.
    await t.admin.db
      .insert(platformReference)
      .values({ key: 'enRates', payload: refDB.enRates, checksum: 'x', source: 'этап 1' });
    await t.admin.db
      .update(platformReference)
      .set({
        payload: {
          banks: dicts.banks,
          cats: dicts.cats,
          forms: dicts.forms,
          reasons: dicts.reasons,
        },
        checksum: 'x',
      })
      .where(sql`${platformReference.key} = 'dictionaries'`);
    const report = await seedPlatformReference(t.admin.db, refDB, 'test', { update: true });
    expect(report.removed).toBe(1);
    const keys = (await t.admin.db.select().from(platformReference)).map((r) => r.key);
    expect(keys).not.toContain('enRates');
    const [dictionaries] = await t.admin.db
      .select()
      .from(platformReference)
      .where(sql`${platformReference.key} = 'dictionaries'`);
    expect(Object.keys(dictionaries!.payload as object).sort()).toEqual([]);
  });

  it('справочники платформы читаются ролью приложения, демо-организация — только в своём контексте', async () => {
    expect(await t.app.db.$count(platformReference)).toBeGreaterThan(0);
    expect(await t.app.db.$count(gkedItems)).toBeGreaterThan(1000);
    const own = await withOrgContext(t.app.db, { orgId: DEMO_ORG_ID }, (tx) =>
      tx.select().from(organizations),
    );
    expect(own[0]).toMatchObject({
      slug: 'buhgalter-plyus',
      address: 'г. Бишкек, ул. Киевская, 95, офис 12',
      phone: '+996312901234',
      head: 'Садыков Эркин Маратович',
      createdAt: new Date('2025-02-13T18:00:00Z'),
    });
  });

  it('--update досоздаёт пустые поля профиля демо-организации и не трогает изменённые', async () => {
    await t.admin.db
      .update(organizations)
      .set({ address: null, head: 'Новый руководитель' })
      .where(eq(organizations.id, DEMO_ORG_ID));
    await seedAll(t.admin.db, { update: true, demo: true });
    const [org] = await t.admin.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, DEMO_ORG_ID));
    expect(org).toMatchObject({
      address: 'г. Бишкек, ул. Киевская, 95, офис 12',
      head: 'Новый руководитель',
    });
  });

  it('запросы «Попросить добавить» демо-организации из demoDB.json: статус, ответ, автор; повтор не дублирует', async () => {
    const rows = await withOrgContext(t.app.db, { orgId: DEMO_ORG_ID }, (tx) =>
      tx
        .select({
          dict: dictChangeRequests.dict,
          what: dictChangeRequests.what,
          status: dictChangeRequests.status,
          answer: dictChangeRequests.answer,
          by: users.login,
          decided: dictChangeRequests.decidedAt,
        })
        .from(dictChangeRequests)
        .innerJoin(users, eq(users.id, dictChangeRequests.createdBy))
        .orderBy(dictChangeRequests.createdAt),
    );
    // Запрос другой организации из demoDB.json в демо-организацию не попадает; seedAll уже запускался дважды.
    expect(rows.map((r) => [r.dict, r.what, r.status])).toEqual([
      ['types', 'Форма 1-ИП (Нацстатком)', 'rejected'],
      ['banks', 'Элдик Банк', 'added'],
      ['cats', 'Сверка с Соцфондом', 'new'],
    ]);
    expect(rows[0]!.answer).toContain('В каталоге уже есть формы Нацстаткома для ИП');
    expect(rows[0]!.decided).toEqual(new Date('2026-10-07T04:20:00Z'));
    expect(rows[2]).toMatchObject({ answer: '', decided: null });
    expect(new Set(rows.map((r) => r.by)).size).toBe(3);
  });

  it('демо-сотрудники: роли из demoDB.json, вход паролем DEMO_PASSWORD только после --update с паролем', async () => {
    const staff = await withOrgContext(t.app.db, { orgId: DEMO_ORG_ID }, (tx) =>
      tx
        .select({
          login: users.login,
          role: roles.name,
          isOwner: roles.isOwner,
          active: employees.active,
        })
        .from(employees)
        .innerJoin(users, eq(users.id, employees.userId))
        .innerJoin(roles, eq(roles.id, employees.roleId))
        .orderBy(users.login),
    );
    expect(staff).toHaveLength(7);
    expect(staff.find((e) => e.login === 'erkin')).toMatchObject({ isOwner: true });
    expect(staff.find((e) => e.login === 'meerim')?.role).toBe('Главный бухгалтер');
    expect(staff.find((e) => e.login === 'bakyt')).toMatchObject({
      role: 'Бухгалтер',
      active: false,
    });

    const hashOf = async () =>
      (
        await t.admin.db
          .select()
          .from(users)
          .where(eq(users.id, demoId('user', 'e3')))
      )[0]!.passwordHash;
    expect(await verifyPassword(await hashOf(), 'demo')).toBe(false);
    await seedAll(t.admin.db, { update: true, demo: true, demoPassword: 'demo' });
    expect(await verifyPassword(await hashOf(), 'demo')).toBe(true);

    // Тот же пароль — хеш и сеансы не меняются; новый пароль — старые сеансы закрываются.
    const userId = demoId('user', 'e3');
    await t.admin.db.insert(sessions).values({
      userId,
      orgId: DEMO_ORG_ID,
      tokenHash: 'seed-test-session',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const sessionsOf = () => t.admin.db.select().from(sessions).where(eq(sessions.userId, userId));
    const before = await hashOf();
    await seedAll(t.admin.db, { update: true, demo: true, demoPassword: 'demo' });
    expect(await hashOf()).toBe(before);
    expect(await sessionsOf()).toHaveLength(1);
    await seedAll(t.admin.db, { update: true, demo: true, demoPassword: 'demo-2026-new' });
    expect(await verifyPassword(await hashOf(), 'demo-2026-new')).toBe(true);
    expect(await sessionsOf()).toHaveLength(0);
    await seedAll(t.admin.db, { update: true, demo: true, demoPassword: 'demo' });
  });

  it('администратор платформы: создаётся с временным паролем, повторное наполнение пароль не меняет', async () => {
    const result = await seedAll(t.admin.db, {
      update: true,
      demo: false,
      platformAdmin: { login: ' KutmanAmin ', password: '12345678' },
    });
    expect(result.platformAdmin).toEqual({ login: 'kutmanamin', created: true });
    const adminOf = async () =>
      (await t.admin.db.select().from(users).where(eq(users.login, 'kutmanamin')))[0]!;
    const admin = await adminOf();
    expect(admin).toMatchObject({ isPlatformAdmin: true, mustChangePassword: true, orgId: null });
    expect(await verifyPassword(admin.passwordHash, '12345678')).toBe(true);
    // Пароль в отчёте наполнения не печатается.
    expect(JSON.stringify(result)).not.toContain('12345678');

    const again = await seedAll(t.admin.db, {
      update: true,
      demo: false,
      platformAdmin: { login: 'kutmanamin', password: 'другой-пароль' },
    });
    expect(again.platformAdmin).toEqual({ login: 'kutmanamin', created: false });
    expect((await adminOf()).passwordHash).toBe(admin.passwordHash);

    await expect(
      seedAll(t.admin.db, {
        update: false,
        demo: false,
        platformAdmin: { login: 'ERKIN', password: '12345678' },
      }),
    ).rejects.toThrow(/занят сотрудником организации/);
  });

  it('администратор платформы: забытый пароль сбрасывается только явной отметкой — временный пароль, сеансы завершены, блокировка входа снята', async () => {
    await seedAll(t.admin.db, {
      update: true,
      demo: false,
      platformAdmin: { login: 'resetadmin', password: '12345678' },
    });
    const adminOf = async () =>
      (await t.admin.db.select().from(users).where(eq(users.login, 'resetadmin')))[0]!;
    // Администратор сменил временный пароль, вошёл и потом пять раз ошибся паролем.
    const { id } = await adminOf();
    await t.admin.db
      .update(users)
      .set({ passwordHash: await hashPassword('мой-пароль-1'), mustChangePassword: false })
      .where(eq(users.id, id));
    await t.admin.db.insert(sessions).values({
      userId: id,
      tokenHash: 'reset-admin-session',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await t.admin.db
      .insert(loginAttempts)
      .values({ login: 'resetadmin', failures: 5, lockedUntil: new Date(Date.now() + 900_000) });
    // У администратора привязан Telegram и есть действующий код «Забыли пароль?».
    await t.admin.db.insert(telegramLinks).values({ userId: id, chatId: 777_001 });
    await t.admin.db.insert(passwordResetCodes).values({
      userId: id,
      codeHash: 'reset-admin-code',
      expiresAt: new Date(Date.now() + 600_000),
    });
    const before = await adminOf();
    const sessionsOf = async () =>
      (await t.admin.db.select().from(sessions).where(eq(sessions.userId, id))).length;
    const attemptsOf = async () =>
      (await t.admin.db.select().from(loginAttempts).where(eq(loginAttempts.login, 'resetadmin')))
        .length;

    // Без отметки — ничего не меняется.
    const plain = await seedAll(t.admin.db, {
      update: true,
      demo: false,
      platformAdmin: { login: 'resetadmin', password: 'новый-временный' },
    });
    expect(plain.platformAdmin).toEqual({ login: 'resetadmin', created: false });
    expect(await adminOf()).toMatchObject({
      passwordHash: before.passwordHash,
      version: before.version,
    });
    expect(await sessionsOf()).toBe(1);
    expect(
      await t.admin.db.select().from(telegramOutbox).where(eq(telegramOutbox.userId, id)),
    ).toEqual([]);

    // С отметкой — пароль снова временный из настроек, сеансов нет, вход открыт.
    const reset = await seedAll(t.admin.db, {
      update: true,
      demo: false,
      platformAdmin: { login: ' ResetAdmin ', password: 'новый-временный', resetPassword: true },
    });
    expect(reset.platformAdmin).toEqual({ login: 'resetadmin', created: false, reset: true });
    expect(JSON.stringify(reset)).not.toContain('новый-временный');
    const after = await adminOf();
    expect(after).toMatchObject({ isPlatformAdmin: true, mustChangePassword: true, orgId: null });
    expect(after.version).toBe(before.version + 1);
    expect(await verifyPassword(after.passwordHash, 'новый-временный')).toBe(true);
    expect(await verifyPassword(after.passwordHash, 'мой-пароль-1')).toBe(false);
    expect(await sessionsOf()).toBe(0);
    expect(await attemptsOf()).toBe(0);
    const [code] = await t.admin.db
      .select()
      .from(passwordResetCodes)
      .where(eq(passwordResetCodes.userId, id));
    expect(code!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    // Бот сообщит о сбросе: сообщение в очереди отправки администратору (без организации).
    const queued = await t.admin.db
      .select()
      .from(telegramOutbox)
      .where(eq(telegramOutbox.userId, id));
    expect(queued).toEqual([
      expect.objectContaining({
        orgId: null,
        chatId: 777_001,
        kind: 'pass_reset',
        status: 'pending',
        text: expect.stringMatching(
          /^🔑 Пароль учётной записи resetadmin сброшен: .*Сбросил: ручной запуск «Migrate test» в GitHub\.$/,
        ),
      }),
    ]);
    expect(queued[0]!.text).not.toContain('новый-временный');

    // Пароль сотрудника организации отметка не сбрасывает.
    const [erkin] = await t.admin.db.select().from(users).where(eq(users.login, 'erkin'));
    await expect(
      seedAll(t.admin.db, {
        update: false,
        demo: false,
        platformAdmin: { login: 'erkin', password: '12345678', resetPassword: true },
      }),
    ).rejects.toThrow(/занят сотрудником организации/);
    const [erkinAfter] = await t.admin.db.select().from(users).where(eq(users.login, 'erkin'));
    expect(erkinAfter?.passwordHash).toBe(erkin?.passwordHash);
  });

  it('каталог прав из refDB.json должен совпадать с системным', async () => {
    const refDB = await readSpecJson<{ permissions: { id: string }[] }>('data/refDB.json');
    const extra = [...refDB.permissions, { id: 'newRight', group: 'cps', name: 'Новое', desc: '' }];
    await expect(seedPermissions(t.admin.db, extra, { update: true })).rejects.toThrow(
      /расходится/,
    );
  });
});
