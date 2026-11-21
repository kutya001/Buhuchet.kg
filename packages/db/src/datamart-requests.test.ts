import { createHash, randomUUID } from 'node:crypto';
import type { ListQuery } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import {
  dmRequestsToday,
  exportDmRequests,
  listDmRequestsPage,
  listDmRequestValues,
} from './datamart-requests';
import { insertDmToken } from './datamart-tokens';
import { createOrganization, type CreatedOrganization } from './organizations';
import { dmRequests, dmTemplates, users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const texts = (key: string) =>
  ({
    'dm.tok.who_admin': 'Администратор платформы',
    'dm.res.ok': 'Успешно',
    'dm.res.error': 'Ошибка',
  })[key] ?? key;

const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  sort: undefined,
  page: 1,
  size: 25,
  filters: {},
  ...over,
});

// Админка → «Журнал запросов» (доработки 20.11.2026: Витрина данных, блок 6, пункт 7; поток Т, этап 2,
// П11; прототип `renderDmLog`): только запросы по токенам, только администратору платформы.
describe.skipIf(!databaseAvailable())('витрина данных: журнал запросов Админки', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let adminId = '';
  let tokenA = '';
  let tokenAdm = '';
  let templateId = '';
  const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, fn);

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810490',
      slug: 'dmr-a',
      owner: { fullName: 'Владелец Тест', login: 'dmr-owner-a', passwordHash: 'x' },
    });
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'dmr-platform', passwordHash: 'x', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    const [org, adm] = await db.admin.db
      .insert(dmTemplates)
      .values([
        { code: 'dmr-org', name: 'Отчёты', module: 'reports', state: 'published' },
        { code: 'dmr-adm', name: 'Организации', audience: 'admin', state: 'published' },
      ])
      .returning({ id: dmTemplates.id });
    templateId = org!.id;
    tokenA = (
      await withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, (tx) =>
        insertDmToken(tx, {
          templateId,
          name: 'Excel',
          tokenHash: hash('a'),
          prefix: 'bk_aaaaaa',
          termDays: 30,
        }),
      )
    ).id;
    tokenAdm = (
      await asAdmin((tx) =>
        insertDmToken(tx, {
          templateId: adm!.id,
          name: 'Power BI',
          tokenHash: hash('b'),
          prefix: 'bk_bbbbbb',
          termDays: 30,
        }),
      )
    ).id;
    // Сдвиги — в миллисекундах: порядок строк задан, а «сегодня» по Бишкеку не кончится между ними
    // (сдвиг в минутах около 00:00 по Бишкеку унёс бы часть строк во «вчера»).
    const at = (ms: number) => sql`now() - make_interval(secs => ${ms}::numeric / 1000)`;
    await db.admin.db.insert(dmRequests).values([
      {
        orgId: a.orgId,
        tokenId: tokenA,
        templateId,
        via: 'api',
        params: { month: '2026-11', status: 'due' },
        rowCount: 12,
        durationMs: 40,
        outcome: 'ok',
        ip: '10.0.0.1',
        at: at(3),
      },
      {
        orgId: a.orgId,
        tokenId: tokenA,
        templateId,
        via: 'api',
        params: {},
        outcome: 'rate',
        error: 'Слишком часто, повторите через 5 секунд',
        ip: '10.0.0.1',
        at: at(2),
      },
      {
        tokenId: tokenAdm,
        templateId: adm!.id,
        via: 'api',
        params: {},
        rowCount: 3,
        durationMs: 9,
        outcome: 'ok',
        ip: '10.0.0.2',
        at: at(1),
      },
      // «Вывод» сотрудника — не запрос по токену: в журнал Админки не идёт.
      { orgId: a.orgId, userId: a.ownerUserId, templateId, via: 'screen', outcome: 'ok' },
      // Позавчерашняя ошибка по токену А: в плашки «сегодня» не идёт, в списке — последней.
      {
        orgId: a.orgId,
        tokenId: tokenA,
        templateId,
        via: 'api',
        outcome: 'error',
        at: sql`now() - interval '2 days'`,
      },
    ]);
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('только запросы по токенам, сначала новые: организация, токен, шаблон, параметры строкой', async () => {
    const page = await asAdmin((tx) => listDmRequestsPage(tx, query(), texts));
    expect(page.total).toBe(4);
    expect(page.rows.map((x) => [x.orgName, x.tokenName, x.prefix, x.tplName, x.outcome])).toEqual([
      ['Администратор платформы', 'Power BI', 'bk_bbbbbb', 'Организации', 'ok'],
      ['Организация А', 'Excel', 'bk_aaaaaa', 'Отчёты', 'rate'],
      ['Организация А', 'Excel', 'bk_aaaaaa', 'Отчёты', 'ok'],
      ['Организация А', 'Excel', 'bk_aaaaaa', 'Отчёты', 'error'],
    ]);
    expect(page.rows[2]).toMatchObject({
      tokenId: tokenA,
      params: 'month=2026-11&status=due',
      rows: 12,
      ms: 40,
      ip: '10.0.0.1',
      error: null,
    });
    expect(page.rows[1]).toMatchObject({
      params: '',
      error: 'Слишком часто, повторите через 5 секунд',
    });
  });

  it('фильтр «Итог: Ошибка», поиск по началу токена, значения «Организации»', async () => {
    const errors = await asAdmin((tx) =>
      listDmRequestsPage(tx, query({ filters: { res: { type: 'enum', vals: ['err'] } } }), texts),
    );
    expect(errors.rows.map((x) => x.outcome)).toEqual(['rate', 'error']);
    const found = await asAdmin((tx) =>
      listDmRequestsPage(tx, query({ search: { q: 'bk_bbb', keys: ['tok'] } }), texts),
    );
    expect(found.rows.map((x) => x.tokenName)).toEqual(['Power BI']);
    const values = await asAdmin((tx) => listDmRequestValues(tx, 'org', texts));
    expect(values.items.map((v) => v.label).sort()).toEqual([
      'Администратор платформы',
      'Организация А',
    ]);
    const file = await asAdmin((tx) => exportDmRequests(tx, query(), ['at', 'res', 'tok'], texts));
    expect(file.rows).toHaveLength(4);
  });

  it('плашки «сегодня» по Бишкеку: запросов и ошибок; позавчерашние не считаются', async () => {
    expect(await asAdmin((tx) => dmRequestsToday(tx))).toEqual({ today: 3, errors: 1 });
  });

  it('в контексте организации — только её строки, токена Админки не видно; без права — пусто', async () => {
    const own = await withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, (tx) =>
      listDmRequestsPage(tx, query(), texts),
    );
    // Две сегодняшние и позавчерашняя — все по токену организации.
    expect(own.rows.map((x) => x.tokenId)).toEqual([tokenA, tokenA, tokenA]);
    const stranger = await withUserContext(db.app.db, randomUUID(), (tx) =>
      listDmRequestsPage(tx, query(), texts),
    );
    expect(stranger.total).toBe(0);
  });
});
