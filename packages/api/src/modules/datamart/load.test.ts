import { loadDatabaseConfig } from '@buhuchet/adapters';
import { schema, type DmOutputTemplate, type DmTemplateColumn } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import { UI_TEXTS } from '@buhuchet/domain';
import { DmRunResult } from '@buhuchet/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiRequest,
  createRaceApp,
  createStaffFixture,
  signIn,
  TEST_PASSWORD,
} from '../../testing';
import { withRunSlot } from './output';
import { DM_RUN_ALL_LIMIT, DM_RUN_SLOTS, runDmTemplate, type DmRunOutcome } from './run';

/*
 * Нагрузка «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 8, пункты 5 и 9; общий план
 * 20.11, этап 3, П1): выгрузки читают ту же базу, в которой работают сотрудники, и пределы не дают
 * тяжёлым запросам затормозить всех. Здесь запросы настоящие и идут одновременно на пуле такого же
 * размера, как у сайта (`DATABASE_POOL_MAX`), а не на пуле тестов из одного соединения (CI, п. О-53):
 *   - тяжёлые запросы с экрана держат не больше `DM_RUN_SLOTS` мест на весь сайт (п. О-96), запрос по
 *     токену — своё (поток Т, п. Т-20); третий «Показать» сразу получает «Сейчас выполняется много
 *     запросов», второй «Показать» того же человека — «Предыдущий запрос ещё выполняется»;
 *   - пока тяжёлые идут, обычные запросы сотрудников обеих организаций уже ответили;
 *   - предел времени обрывает тяжёлый запрос, места освобождаются;
 *   - 50 000 строк «Показать» отдаёт целиком и с отметкой «есть ещё».
 * Предел 15 с здесь короче (`timeoutMs`), чтобы тест шёл секунды: сам предел проверяют тесты
 * исполнителя (`packages/db/src/datamart-run.test.ts`).
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const { dmTemplates, dmTemplateSql, rateLimits } = schema;
const txt = (key: string) => UI_TEXTS[key as keyof typeof UI_TEXTS]?.ru ?? key;

/**
 * Пул сайта: `DATABASE_POOL_MAX` по умолчанию (как на стенде и рабочем сайте) — из схемы настроек,
 * адрес базы здесь только для проверки схемы.
 */
const SITE_POOL = loadDatabaseConfig({
  APP_ENV: 'test',
  DATABASE_URL: 'postgres://pool-default',
}).DATABASE_POOL_MAX;
/** Сколько идёт тяжёлый запрос до своего предела времени (на сайте — 15 с). */
const HEAVY_MS = 8_000;
/**
 * Тяжёлый запрос — счёт без таблиц: строки идут потоком, без памяти и временных файлов, и заканчивает
 * его только предел времени.
 */
const HEAVY = 'select count(*)::bigint as n from (select generate_series(1, 2000000000000)) s';

const col = (code: string, type: DmTemplateColumn['type'] = 'text'): DmTemplateColumn => ({
  code,
  name: `Столбец ${code}`,
  type,
  total: false,
  contractor: false,
});

describe.skipIf(!databaseAvailable())('Витрина данных: нагрузка', () => {
  let f: Fixture;
  let load: ReturnType<typeof createRaceApp>;
  const cookies: Record<string, string> = {};
  const tpl: Record<string, string> = {};

  const call = (login: string, method: 'GET' | 'POST', path: string, body?: unknown) =>
    apiRequest(load.app, method, path, cookies[login], body);
  const run = (login: string, code: string) =>
    call(login, 'POST', '/api/dm/output/run', { code, params: {} });
  const errorCode = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;

  /** Шаблон тяжёлого запроса для исполнителя — как его отдаёт `dmOutputTemplate`. */
  const heavyTemplate = (): DmOutputTemplate => ({
    id: tpl['load-heavy']!,
    code: 'load-heavy',
    name: 'Шаблон load-heavy',
    description: null,
    audience: 'org',
    module: 'cps',
    needPermission: null,
    state: 'published',
    params: [],
    columns: [col('n', 'num')],
  });
  /** Запрос по токену пишется в журнал с токеном своей организации. */
  let tokenB = '';
  const heavy = (orgId: string, userId: string, via: 'screen' | 'api') =>
    runDmTemplate(load.deps, {
      template: heavyTemplate(),
      query: HEAVY,
      input: {},
      who: { kind: 'org', orgId, userId },
      ownContractorIds: null,
      via,
      tokenId: via === 'api' ? tokenB : null,
      ip: null,
      maxRows: 10,
      today: '2026-11-21',
      timeoutMs: HEAVY_MS,
    });

  /**
   * Сколько запросов шаблонов сейчас выполняет база на пуле нагрузки: исполнитель зовёт `dm.run_org`
   * (текст шаблона — параметром), лёгкие запуски теста к этому моменту уже ответили.
   */
  const heavyRunning = async () => {
    const [r] = await f.t.admin.db.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_stat_activity
      where application_name = 'buhuchet-test-load' and state = 'active'
        and query like ${'select dm.run_org(%'}`);
    return r!.n;
  };
  /** Занятые места запусков с экрана (`dm_run_all`). */
  const slotsTaken = async () =>
    (
      await f.t.admin.db
        .select({ n: sql<number>`count(*)::int` })
        .from(rateLimits)
        .where(
          and(eq(rateLimits.kind, DM_RUN_ALL_LIMIT.kind), gt(rateLimits.busyUntil, sql`now()`)),
        )
    )[0]!.n;

  beforeAll(async () => {
    f = await createStaffFixture();
    load = createRaceApp(f.t.appUrl, f.deps, {
      max: SITE_POOL,
      applicationName: 'buhuchet-test-load',
    });
    for (const login of ['owner-a', 'acc-a', 'owner-b', 'platform-admin']) {
      cookies[login] = await signIn(load.app, login, TEST_PASSWORD);
    }
    const add = async (code: string, query: string) => {
      const [t] = await f.t.admin.db
        .insert(dmTemplates)
        .values({
          code,
          name: `Шаблон ${code}`,
          module: 'cps',
          state: 'published',
          columns: [col('n', 'num')],
        })
        .returning({ id: dmTemplates.id });
      tpl[code] = t!.id;
      await f.t.admin.db.insert(dmTemplateSql).values({ templateId: t!.id, query });
    };
    await add('load-heavy', HEAVY);
    await add('load-light', 'select 1 as n');
    await add('load-big', 'select g as n from generate_series(1, 50001) g order by g');
    const [token] = await f.t.admin.db
      .insert(schema.dmTokens)
      .values({
        orgId: f.b.orgId,
        templateId: tpl['load-heavy']!,
        name: 'Нагрузка',
        tokenHash: 'c'.repeat(64),
        prefix: 'bk_load',
        expiresAt: new Date(Date.now() + 86_400_000),
        createdBy: f.b.ownerUserId,
      })
      .returning({ id: schema.dmTokens.id });
    tokenB = token!.id;
  });

  afterAll(async () => {
    await load?.close();
    await f?.t.drop();
  });

  it(
    'тяжёлые запросы держат не больше своих мест, а обычные запросы сотрудников отвечают, пока они идут',
    { timeout: 60_000 },
    async () => {
      expect(SITE_POOL).toBe(5);
      expect(DM_RUN_SLOTS).toBe(2);
      const finished: DmRunOutcome[] = [];
      const track = (p: Promise<DmRunOutcome>) =>
        p.then((out) => {
          finished.push(out);
          return out;
        });
      const started = Date.now();

      // Владелец А — «Показать» тяжёлого шаблона (своя очередь человека и место на весь сайт),
      // организация Б — запрос по токену (мимо мест с экрана).
      const mine = track(
        withRunSlot(load.deps, f.a.ownerUserId, txt, () =>
          heavy(f.a.orgId, f.a.ownerUserId, 'screen'),
        ),
      );
      const byToken = track(heavy(f.b.orgId, f.b.ownerUserId, 'api'));
      await expect.poll(heavyRunning, { timeout: HEAVY_MS / 2 }).toBe(2);

      // Тот же человек — ждёт свой запрос; другая организация — берёт второе место и получает ответ.
      const again = await run('owner-a', 'load-light');
      expect(again.status).toBe(429);
      expect(await errorCode(again)).toBe('dm_busy');
      const other = await run('owner-b', 'load-light');
      expect(other.status, await other.clone().text()).toBe(200);
      expect(DmRunResult.parse(await other.json()).rows).toEqual([[1]]);

      // Второе место — тяжёлый запрос Б; третий «Показать» на весь сайт — сразу отказ.
      const second = track(heavy(f.b.orgId, f.b.ownerUserId, 'screen'));
      await expect.poll(heavyRunning, { timeout: HEAVY_MS / 2 }).toBe(3);
      expect(await slotsTaken()).toBe(DM_RUN_SLOTS);
      const full = await call('platform-admin', 'POST', '/api/admin/dm/output/run', {
        code: 'load-light',
        params: {},
        orgId: f.a.orgId,
      });
      expect(full.status).toBe(429);
      expect(await errorCode(full)).toBe('dm_busy_all');

      // Обычная работа обеих организаций — пока все три тяжёлых ещё идут (каталог «Шаблонов» — у
      // владельцев: у бухгалтера нет права «Смотреть витрину данных»).
      const common = ['/api/auth/me', '/api/org/policy', '/api/org/ext-api'];
      const usual = await Promise.all([
        ...['owner-a', 'acc-a', 'owner-b'].flatMap((login) =>
          common.map((path) => call(login, 'GET', path)),
        ),
        call('owner-a', 'GET', '/api/dm/output'),
        call('owner-b', 'GET', '/api/dm/output'),
      ]);
      expect(usual.map((r) => r.status)).toEqual(usual.map(() => 200));
      // Тяжёлые ещё идут — по `finished`, а не по часам: между пределом времени и завершением обещания
      // есть короткое окно, где часы уже «прошли», а запуск ещё не закончен.
      expect(finished).toEqual([]);

      // Предел времени обрывает все три; места свободны — «Показать» снова отвечает.
      expect(await Promise.all([mine, byToken, second])).toEqual([
        { ok: false, outcome: 'timeout' },
        { ok: false, outcome: 'timeout' },
        { ok: false, outcome: 'timeout' },
      ]);
      expect(Date.now() - started).toBeGreaterThanOrEqual(HEAVY_MS);
      expect(await slotsTaken()).toBe(0);
      const after = await run('owner-a', 'load-light');
      expect(after.status, await after.clone().text()).toBe(200);
    },
  );

  it(
    '50 000 строк: «Показать» отдаёт их все одним ответом и отмечает, что строк больше',
    { timeout: 30_000 },
    async () => {
      const res = await run('owner-a', 'load-big');
      expect(res.status, await res.clone().text()).toBe(200);
      const out = DmRunResult.parse(await res.json());
      expect(out).toMatchObject({ more: true, max: 50_000 });
      expect(out.rows).toHaveLength(50_000);
      expect(out.rows[0]).toEqual([1]);
      expect(out.rows[49_999]).toEqual([50_000]);
    },
  );
});
