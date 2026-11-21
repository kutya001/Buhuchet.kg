import { createHash, randomUUID } from 'node:crypto';
import type { ListQuery } from '@buhuchet/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import {
  dmTokenFacts,
  dmTokenRequests,
  dmTokenTemplates,
  insertDmToken,
  listDmTokensPage,
  lockDmTokens,
  replaceDmToken,
  revokeDmToken,
  type DmTokenListRow,
} from './datamart-tokens';
import { createOrganization, type CreatedOrganization } from './organizations';
import { dmRequests, dmTemplateOrgs, dmTemplates, dmTemplateSql, users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const DAY = 86_400_000;
const TODAY = '2026-11-20' as const;
const since = () => new Date(Date.now() - 30 * DAY);

// API-токены «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 5; поток Т, этап 1, П14):
// выпуск, отзыв, перевыпуск и факты для состояния — в контексте своей организации или Админки.
describe.skipIf(!databaseAvailable())('витрина данных: API-токены', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId = '';
  const tpl = { all: '', selected: '', draft: '', admin: '' };
  type Fn<T> = Parameters<typeof withOrgContext<T>>[2];
  const inA = <T>(fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, fn);
  const issue = (templateId: string, name: string, termDays = 30) => {
    const raw = `bk_${randomUUID().replaceAll('-', '')}`;
    return {
      templateId,
      name,
      tokenHash: hash(raw),
      prefix: raw.slice(0, 9),
      termDays,
    };
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец Тест', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810470',
      slug: 'dmt-a',
      owner: owner('dmt-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810471',
      slug: 'dmt-b',
      owner: owner('dmt-owner-b'),
    });
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'dmt-platform', passwordHash: 'x', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    const add = async (code: string, over: Partial<typeof dmTemplates.$inferInsert>) => {
      const [t] = await asAdmin((tx) =>
        tx
          .insert(dmTemplates)
          .values({ code, name: `Шаблон ${code}`, module: 'reports', state: 'published', ...over })
          .returning({ id: dmTemplates.id }),
      );
      await asAdmin((tx) =>
        tx.insert(dmTemplateSql).values({ templateId: t!.id, query: 'select 1 as n' }),
      );
      return t!.id;
    };
    tpl.all = await add('tok-all', {});
    tpl.selected = await add('tok-selected', { access: 'selected' });
    tpl.draft = await add('tok-draft', { state: 'draft' });
    tpl.admin = await add('tok-admin', { audience: 'admin', module: null });
    await asAdmin((tx) =>
      tx.insert(dmTemplateOrgs).values({ templateId: tpl.selected, orgId: a.orgId }),
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('шаблоны окна «Новый API-токен»: организации — опубликованные «для организаций» с доступом, Админке — свои', async () => {
    const codesA = (await inA((tx) => dmTokenTemplates(tx, 'org'))).map((t) => t.code);
    const codesB = (await inB((tx) => dmTokenTemplates(tx, 'org'))).map((t) => t.code);
    expect(codesA.sort()).toEqual(['tok-all', 'tok-selected']);
    expect(codesB).toEqual(['tok-all']);
    // Шаблон Админки организации не виден, даже если спросить его прямо.
    expect(await inA((tx) => dmTokenTemplates(tx, 'admin'))).toEqual([]);
    const admin = await asAdmin((tx) => dmTokenTemplates(tx, 'admin'));
    expect(admin.map((t) => t.code)).toEqual(['tok-admin']);
    expect(admin[0]).toMatchObject({ module: null, needPermission: null, columns: [] });
  });

  it('выпуск: организация и автор — из контекста, срок — от «сейчас» базы; чужая организация и черновик — нельзя', async () => {
    const made = await inA(async (tx) => {
      await lockDmTokens(tx, a.orgId);
      return insertDmToken(tx, issue(tpl.all, 'Power BI', 7));
    });
    expect(made.expiresAt.getTime() - made.createdAt.getTime()).toBe(7 * DAY);
    const { now, items } = await inA((tx) => dmTokenFacts(tx, { since: since(), today: TODAY }));
    expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(60_000);
    const mine = items.find((k) => k.id === made.id)!;
    expect(mine).toMatchObject({
      orgId: a.orgId,
      orgName: 'Организация А',
      templateName: 'Шаблон tok-all',
      templateState: 'published',
      templateAccess: true,
      name: 'Power BI',
      createdBy: a.ownerUserId,
      createdByAdmin: false,
      createdByLeft: false,
      extApi: false,
      orgBlocked: false,
      revokedAt: null,
      requests: 0,
    });
    expect(mine.createdByName).toBeTruthy();
    // Чужая организация токена не видит.
    expect((await inB((tx) => dmTokenFacts(tx, { since: since(), today: TODAY }))).items).toEqual(
      [],
    );
    // Черновик и шаблон без доступа выпустить нельзя (проверки базы).
    await expect(inA((tx) => insertDmToken(tx, issue(tpl.draft, 'Черновик')))).rejects.toThrow();
    await expect(
      inB((tx) => insertDmToken(tx, issue(tpl.selected, 'Без доступа'))),
    ).rejects.toThrow();
    await expect(inA((tx) => insertDmToken(tx, issue(tpl.admin, 'Чужой вид')))).rejects.toThrow();
  });

  it('доступ, блокировка и «Внешний доступ по API» — в фактах; доступ убрали — токен это видит', async () => {
    const made = await inA((tx) => insertDmToken(tx, issue(tpl.selected, 'По доступу')));
    const fact = async () =>
      (await inA((tx) => dmTokenFacts(tx, { since: since(), today: TODAY, id: made.id })))
        .items[0]!;
    expect((await fact()).templateAccess).toBe(true);
    await asAdmin((tx) =>
      tx
        .delete(dmTemplateOrgs)
        .where(and(eq(dmTemplateOrgs.templateId, tpl.selected), eq(dmTemplateOrgs.orgId, a.orgId))),
    );
    expect(await fact()).toMatchObject({
      templateAccess: false,
      templateName: 'Шаблон tok-selected',
    });
    await db.admin.db.execute(`update org_settings set ext_api = true where org_id = '${a.orgId}'`);
    expect((await fact()).extApi).toBe(true);
  });

  it('шаблон сменил вид на «Для администратора» — для токена организации он отключён', async () => {
    const [t] = await asAdmin((tx) =>
      tx
        .insert(dmTemplates)
        .values({
          code: 'tok-moved',
          name: 'Шаблон tok-moved',
          module: 'reports',
          state: 'published',
        })
        .returning({ id: dmTemplates.id }),
    );
    await asAdmin((tx) =>
      tx.insert(dmTemplateSql).values({ templateId: t!.id, query: 'select 1 as n' }),
    );
    const made = await inA((tx) => insertDmToken(tx, issue(t!.id, 'Сменил вид')));
    const fact = async () =>
      (await inA((tx) => dmTokenFacts(tx, { since: since(), today: TODAY, id: made.id })))
        .items[0]!;
    expect((await fact()).templateState).toBe('published');
    await asAdmin((tx) =>
      tx
        .update(dmTemplates)
        .set({ audience: 'admin', module: null })
        .where(eq(dmTemplates.id, t!.id)),
    );
    expect((await fact()).templateState).toBe('off');
    // И наоборот: шаблон Админки перевели «для организаций» — для токена Админки он отключён.
    const [m] = await asAdmin((tx) =>
      tx
        .insert(dmTemplates)
        .values({
          code: 'tok-moved-adm',
          name: 'Шаблон tok-moved-adm',
          audience: 'admin',
          state: 'published',
        })
        .returning({ id: dmTemplates.id }),
    );
    await asAdmin((tx) =>
      tx.insert(dmTemplateSql).values({ templateId: m!.id, query: 'select 1 as n' }),
    );
    const own = await asAdmin((tx) => insertDmToken(tx, issue(m!.id, 'Сменил вид Админки')));
    const adminFact = async () =>
      (await asAdmin((tx) => dmTokenFacts(tx, { since: since(), today: TODAY, id: own.id })))
        .items[0]!;
    expect((await adminFact()).templateState).toBe('published');
    await asAdmin((tx) =>
      tx
        .update(dmTemplates)
        .set({ audience: 'org', module: 'reports' })
        .where(eq(dmTemplates.id, m!.id)),
    );
    expect((await adminFact()).templateState).toBe('off');
  });

  it('отзыв: сейчас и от своего имени, один раз; администратор отзывает токен организации — организация видит только отметку', async () => {
    const own = await inA((tx) => insertDmToken(tx, issue(tpl.all, 'Отозвать сам')));
    expect(await inA((tx) => revokeDmToken(tx, own.id))).toBe(true);
    expect(await inA((tx) => revokeDmToken(tx, own.id))).toBe(false);
    const f1 = (await inA((tx) => dmTokenFacts(tx, { since: since(), today: TODAY, id: own.id })))
      .items[0]!;
    expect(f1.revokedAt).not.toBeNull();
    expect(f1).toMatchObject({ revokedByAdmin: false });
    expect(f1.revokedByName).toBeTruthy();
    // Чужая организация не отзывает.
    const inBToken = await inB((tx) => insertDmToken(tx, issue(tpl.all, 'Токен Б')));
    expect(await inA((tx) => revokeDmToken(tx, inBToken.id))).toBe(false);
    // Администратор платформы видит все токены и отзывает любой.
    const all = (await asAdmin((tx) => dmTokenFacts(tx, { since: since(), today: TODAY }))).items;
    expect(all.map((k) => k.id)).toEqual(expect.arrayContaining([own.id, inBToken.id]));
    expect(await asAdmin((tx) => revokeDmToken(tx, inBToken.id))).toBe(true);
    const f2 = (
      await inB((tx) => dmTokenFacts(tx, { since: since(), today: TODAY, id: inBToken.id }))
    ).items[0]!;
    expect(f2).toMatchObject({ revokedByAdmin: true, revokedByName: null });
  });

  it('перевыпуск: прежний работает ещё сутки и помнит новый, новый помнит начало прежнего; дважды — нельзя', async () => {
    const old = await inA((tx) => insertDmToken(tx, issue(tpl.all, 'Перевыпуск', 90)));
    const next = await inA(async (tx) => {
      await lockDmTokens(tx, a.orgId);
      const n = await insertDmToken(tx, issue(tpl.all, 'Перевыпуск', 90));
      const grace = await replaceDmToken(tx, old.id, n.id);
      expect(grace!.getTime() - n.createdAt.getTime()).toBe(DAY);
      return n;
    });
    const { items } = await inA((tx) => dmTokenFacts(tx, { since: since(), today: TODAY }));
    const was = items.find((k) => k.id === old.id)!;
    const now = items.find((k) => k.id === next.id)!;
    expect(was.replacedBy).toBe(next.id);
    expect(now.prevPrefix).toBe(was.prefix);
    const other = await inA((tx) => insertDmToken(tx, issue(tpl.all, 'Ещё')));
    expect(await inA((tx) => replaceDmToken(tx, old.id, other.id))).toBeNull();
  });

  it('токен Админки — без организации: организациям не виден', async () => {
    const made = await asAdmin((tx) => insertDmToken(tx, issue(tpl.admin, 'Сводка платформы')));
    const all = (await asAdmin((tx) => dmTokenFacts(tx, { since: since(), today: TODAY }))).items;
    expect(all.find((k) => k.id === made.id)).toMatchObject({
      orgId: null,
      orgName: null,
      createdByAdmin: true,
      createdByName: null,
      templateAccess: true,
    });
    const inOrg = (await inA((tx) => dmTokenFacts(tx, { since: since(), today: TODAY }))).items;
    expect(inOrg.find((k) => k.id === made.id)).toBeUndefined();
    // Администратор платформы не выпускает токен для организации к шаблону Админки.
    await expect(asAdmin((tx) => insertDmToken(tx, issue(tpl.all, 'Нельзя')))).rejects.toThrow();
  });

  it('журнал запросов токена: последние сначала, счёт за период; чужой организации не виден', async () => {
    const made = await inA((tx) => insertDmToken(tx, issue(tpl.all, 'С журналом')));
    const at = (h: number) => new Date(Date.now() - h * 3_600_000);
    await db.admin.db.insert(dmRequests).values([
      {
        orgId: a.orgId,
        tokenId: made.id,
        templateId: tpl.all,
        via: 'api',
        params: { month: '2026-11' },
        rowCount: 12,
        durationMs: 40,
        outcome: 'ok',
        ip: '10.0.0.1',
        at: at(2),
      },
      {
        orgId: a.orgId,
        tokenId: made.id,
        templateId: tpl.all,
        via: 'api',
        outcome: 'rate',
        error: 'Слишком часто',
        ip: '10.0.0.2',
        at: at(1),
      },
      {
        orgId: a.orgId,
        tokenId: made.id,
        templateId: tpl.all,
        via: 'api',
        outcome: 'ok',
        at: at(40 * 24),
      },
    ]);
    const log = await inA((tx) => dmTokenRequests(tx, made.id, 2));
    expect(log.total).toBe(3);
    expect(log.items.map((r) => r.outcome)).toEqual(['rate', 'ok']);
    expect(log.items[1]).toMatchObject({ params: { month: '2026-11' }, rows: 12, ms: 40 });
    expect((await inB((tx) => dmTokenRequests(tx, made.id))).total).toBe(0);
    const fact = (
      await inA((tx) => dmTokenFacts(tx, { since: since(), today: TODAY, id: made.id }))
    ).items[0]!;
    expect(fact.requests).toBe(2);
  });

  it('список: поиск по названию и началу токена, сортировка по созданию — новые сначала', async () => {
    const row = (id: string, name: string, at: string): DmTokenListRow => ({
      id,
      name,
      prefix: `bk_${name.slice(0, 3)}`,
      state: 'active',
      stateText: 'Действует',
      stateRank: 0,
      note: '',
      orgName: 'Организация А',
      tplName: 'Шаблон',
      byName: 'Владелец',
      createdAt: at,
      till: at,
      lastAt: null,
      lastIp: null,
      n30: 0,
    });
    const rows = [
      row(randomUUID(), 'Power BI', '2026-11-01T00:00:00Z'),
      row(randomUUID(), 'Excel', '2026-11-05T00:00:00Z'),
    ];
    const query = (q?: string): ListQuery => ({
      sort: undefined,
      page: 1,
      size: 25,
      filters: {},
      ...(q ? { search: { q, keys: ['name', 'st'] } } : {}),
    });
    const page = await inA((tx) => listDmTokensPage(tx, rows, query()));
    expect(page.rows.map((r) => r.name)).toEqual(['Excel', 'Power BI']);
    const found = await inA((tx) => listDmTokensPage(tx, rows, query('bk_Pow')));
    expect(found.rows.map((r) => r.name)).toEqual(['Power BI']);
  });
});
