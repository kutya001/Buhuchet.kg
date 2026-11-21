import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import {
  dmOutputTemplate,
  dmOutputTemplates,
  dmTemplateCheckError,
  dmTemplateQuery,
  logDmRequest,
  type DmRequestEntry,
} from './datamart-output';
import { insertDmToken, lockDmTokens } from './datamart-tokens';
import { createOrganization, type CreatedOrganization } from './organizations';
import { dmRequests, dmTemplateOrgs, dmTemplates, dmTemplateSql, dmTokens, users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

// «Вывод» «Витрины данных» (доработки 20.11.2026: Витрина данных, блоки 4, 6, 8; этап 2, П3–П4,
// миграция 0171): текст запроса шаблона — только опубликованного с доступом организации, журнал запросов
// — одна функция для экрана и токена, организация и сотрудник — из контекста.
describe.skipIf(!databaseAvailable())('витрина данных: «Вывод» и журнал запросов', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId = '';
  const tpl = { all: '', selected: '', draft: '', broken: '', admin: '' };
  type Fn<T> = Parameters<typeof withOrgContext<T>>[2];
  const inA = <T>(fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, fn);
  const entry = (over: Partial<DmRequestEntry> = {}): DmRequestEntry => ({
    via: 'screen',
    templateId: tpl.all,
    tokenId: null,
    params: { month: '2026-11' },
    rows: 3,
    ms: 12,
    outcome: 'ok',
    error: null,
    ip: null,
    ...over,
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец Тест', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810480',
      slug: 'dmo-a',
      owner: owner('dmo-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810481',
      slug: 'dmo-b',
      owner: owner('dmo-owner-b'),
    });
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'dmo-platform', passwordHash: 'x', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    const add = async (code: string, over: Partial<typeof dmTemplates.$inferInsert>) => {
      const [t] = await db.admin.db
        .insert(dmTemplates)
        .values({ code, name: `Шаблон ${code}`, module: 'reports', state: 'published', ...over })
        .returning({ id: dmTemplates.id });
      await db.admin.db.insert(dmTemplateSql).values({
        templateId: t!.id,
        query: `select '${code}' as n`,
        checkError: `ошибка ${code}`,
      });
      return t!.id;
    };
    tpl.all = await add('dmo-all', {});
    tpl.selected = await add('dmo-selected', { access: 'selected' });
    tpl.draft = await add('dmo-draft', { state: 'draft' });
    tpl.broken = await add('dmo-broken', { state: 'broken' });
    tpl.admin = await add('dmo-admin', { audience: 'admin', module: null });
    await db.admin.db.insert(dmTemplateOrgs).values({ templateId: tpl.selected, orgId: a.orgId });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('шаблоны «Вывода»: организации — опубликованные и сломанные со своим доступом, Админке — все', async () => {
    const codes = (rows: { code: string }[]) => rows.map((r) => r.code).sort();
    expect(codes(await inA((tx) => dmOutputTemplates(tx)))).toEqual([
      'dmo-all',
      'dmo-broken',
      'dmo-selected',
    ]);
    expect(codes(await inB((tx) => dmOutputTemplates(tx)))).toEqual(['dmo-all', 'dmo-broken']);
    expect(codes(await asAdmin((tx) => dmOutputTemplates(tx)))).toEqual([
      'dmo-admin',
      'dmo-all',
      'dmo-broken',
      'dmo-selected',
    ]);
    expect(codes(await asAdmin((tx) => dmOutputTemplates(tx, 'admin')))).toEqual(['dmo-admin']);
    expect(await inB((tx) => dmOutputTemplate(tx, 'dmo-selected'))).toBeNull();
    expect(await inA((tx) => dmOutputTemplate(tx, 'dmo-admin'))).toBeNull();
    expect(await inA((tx) => dmOutputTemplate(tx, 'dmo-all', 'org'))).toMatchObject({
      code: 'dmo-all',
      state: 'published',
    });
  });

  it('текст запроса: организации — только опубликованного шаблона с её доступом; ошибка проверки — только Админке', async () => {
    expect(await inA((tx) => dmTemplateQuery(tx, tpl.all))).toBe("select 'dmo-all' as n");
    expect(await inA((tx) => dmTemplateQuery(tx, tpl.selected))).toBe("select 'dmo-selected' as n");
    for (const id of [tpl.selected, tpl.draft, tpl.broken, tpl.admin]) {
      expect(await inB((tx) => dmTemplateQuery(tx, id))).toBeNull();
    }
    // Без организации и не администратор платформы — ничего.
    expect(
      await withUserContext(db.app.db, a.ownerUserId, (tx) => dmTemplateQuery(tx, tpl.all)),
    ).toBeNull();
    expect(await asAdmin((tx) => dmTemplateQuery(tx, tpl.draft))).toBe("select 'dmo-draft' as n");
    expect(await inA((tx) => dmTemplateCheckError(tx, tpl.broken))).toBeNull();
    expect(await asAdmin((tx) => dmTemplateCheckError(tx, tpl.broken))).toBe('ошибка dmo-broken');
  });

  it('журнал с экрана: организация и сотрудник — из контекста; без сотрудника, с токеном, вне организации не администратор — отказ', async () => {
    const id = await inA((tx) => logDmRequest(tx, entry()));
    const [row] = await db.admin.db.select().from(dmRequests).where(eq(dmRequests.id, id));
    expect(row).toMatchObject({
      orgId: a.orgId,
      userId: a.ownerUserId,
      via: 'screen',
      params: { month: '2026-11' },
      rowCount: 3,
      durationMs: 12,
      outcome: 'ok',
    });
    // Чужая организация строки не видит.
    expect(await inB((tx) => tx.select().from(dmRequests).where(eq(dmRequests.id, id)))).toEqual(
      [],
    );
    await expect(
      withOrgContext(db.app.db, { orgId: a.orgId, userId: null }, (tx) =>
        logDmRequest(tx, entry()),
      ),
    ).rejects.toThrow();
    await expect(
      withUserContext(db.app.db, a.ownerUserId, (tx) => logDmRequest(tx, entry())),
    ).rejects.toThrow();
    await expect(inA((tx) => logDmRequest(tx, entry({ templateId: tpl.admin })))).rejects.toThrow();
    const adm = await asAdmin((tx) => logDmRequest(tx, entry({ templateId: tpl.admin })));
    const [admRow] = await db.admin.db.select().from(dmRequests).where(eq(dmRequests.id, adm));
    expect(admRow).toMatchObject({ orgId: null, userId: adminId });
    // Ошибка — до 300 знаков, адрес — до 64.
    const long = await inA((tx) =>
      logDmRequest(tx, entry({ outcome: 'error', error: 'я'.repeat(400), ip: '1'.repeat(80) })),
    );
    const [cut] = await db.admin.db.select().from(dmRequests).where(eq(dmRequests.id, long));
    expect([cut!.error!.length, cut!.ip!.length]).toEqual([300, 64]);
    // Писать в журнал напрямую роль приложения не может.
    await expect(
      inA((tx) =>
        tx.insert(dmRequests).values({ orgId: a.orgId, via: 'screen', outcome: 'ok', params: {} }),
      ),
    ).rejects.toThrow();
  });

  it('журнал по токену: только токен своей организации; «Последний запрос» токена — сейчас и с этого адреса', async () => {
    const raw = `bk_${randomUUID().replaceAll('-', '')}`;
    const made = await inA(async (tx) => {
      await lockDmTokens(tx, a.orgId);
      return insertDmToken(tx, {
        templateId: tpl.all,
        name: 'Power BI',
        tokenHash: hash(raw),
        prefix: raw.slice(0, 9),
        termDays: 30,
      });
    });
    const api = entry({ via: 'api', tokenId: made.id, ip: '10.1.2.3' });
    // Токен — организации А: из Б, вне организации и без токена — отказ.
    await expect(inB((tx) => logDmRequest(tx, api))).rejects.toThrow();
    await expect(asAdmin((tx) => logDmRequest(tx, api))).rejects.toThrow();
    await expect(inA((tx) => logDmRequest(tx, { ...api, tokenId: null }))).rejects.toThrow();
    // Внешняя программа: сотрудника в контексте может не быть.
    const id = await withOrgContext(db.app.db, { orgId: a.orgId, userId: null }, (tx) =>
      logDmRequest(tx, api),
    );
    const [row] = await db.admin.db.select().from(dmRequests).where(eq(dmRequests.id, id));
    expect(row).toMatchObject({ via: 'api', tokenId: made.id, userId: null, ip: '10.1.2.3' });
    const [tok] = await db.admin.db.select().from(dmTokens).where(eq(dmTokens.id, made.id));
    expect(tok!.lastIp).toBe('10.1.2.3');
    expect(Math.abs(tok!.lastUsedAt!.getTime() - Date.now())).toBeLessThan(60_000);
  });
});
