import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  bishkekDate,
  DM_EXT_PER_MINUTE,
  DM_EXT_REFUSAL_LOGS_PER_MINUTE,
  DM_EXT_RUNS_PLATFORM,
  DM_EXT_TRY_PER_MINUTE,
  UI_TEXTS,
} from '@buhuchet/domain';
import {
  ApiError,
  DmExtAnswer,
  DmRequestList,
  DmRequestSummary,
  DmRunResult,
  DmTokenCard,
  DmTokenIssued,
} from '@buhuchet/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

/*
 * Внешний адрес «Витрины данных» GET /api/ext/v1/<код> (доработки 20.11.2026: Витрина данных, блок 6;
 * блок 8, пункты 1, 5, 6; поток Т, этап 2, П11; приёмка «Токены и внешний адрес»): ответ JSON и CSV,
 * страницы, токен только в заголовке, другой шаблон, изменение по токену, пределы, отзыв и перевыпуск,
 * «Внешний доступ по API», подписка, блокировка, сломанный шаблон, токен Админки, 20 неверных токенов
 * с адреса, автор уволен, запуски платформы заняты, обращения известного токена, журнал запросов и
 * изоляция организаций.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const { dmRequests, dmTemplates, dmTemplateSql, dmTokens, organizations, orgSettings, rateLimits } =
  schema;
const txt = (key: keyof typeof UI_TEXTS) => UI_TEXTS[key].ru;

describe.skipIf(!databaseAvailable())('Витрина данных: внешний адрес по токену', () => {
  let f: Fixture;
  const cookies: Record<string, string> = {};
  let ipN = 0;
  /** Свой адрес у каждого теста: счёт неверных токенов по адресу общий на файл. */
  const nextIp = () => `198.51.100.${++ipN}`;

  const ext = (
    path: string,
    o: { token?: string; ip?: string; method?: 'GET' | 'POST' | 'PUT'; cookie?: string } = {},
  ) =>
    f.app.request(`/api/ext/v1/${path}`, {
      method: o.method ?? 'GET',
      headers: {
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.cookie ? { cookie: o.cookie } : {}),
        'x-forwarded-for': o.ip ?? '203.0.113.7',
      },
    });
  const errOf = async (res: Response) =>
    ((await res.json()) as { error: { code: string; message: string } }).error;
  const expectErr = async (res: Response, status: number, code: string) => {
    expect(res.status, await res.clone().text()).toBe(status);
    const e = await errOf(res);
    expect(e.code).toBe(code);
    return e;
  };
  const issue = async (login: string, code: string, name: string, base = '/api/dm') => {
    const [tpl] = await f.t.admin.db
      .select({ id: dmTemplates.id })
      .from(dmTemplates)
      .where(eq(dmTemplates.code, code));
    const res = await apiRequest(f.app, 'POST', `${base}/tokens`, cookies[login], {
      templateId: tpl!.id,
      name,
      term: 30,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return DmTokenIssued.parse(await res.json());
  };
  const answer = async (res: Response) => {
    expect(res.status, await res.clone().text()).toBe(200);
    return DmExtAnswer.parse(await res.json());
  };
  const logOf = (tokenId: string) =>
    f.t.admin.db
      .select()
      .from(dmRequests)
      .where(eq(dmRequests.tokenId, tokenId))
      .orderBy(dmRequests.id);

  const STAFF_COLUMNS = [
    { code: 'name', name: 'Сотрудник', type: 'text', total: false, contractor: false },
    { code: 'fee', name: 'Сумма', type: 'money', total: true, contractor: false },
    { code: 'nofee', name: 'Без суммы', type: 'money', total: false, contractor: false },
    { code: 'formula', name: 'Формула', type: 'text', total: false, contractor: false },
    { code: 'month', name: 'Месяц', type: 'month', total: false, contractor: false },
    { code: 'cp', name: 'Контрагент', type: 'cp', total: false, contractor: true },
  ];

  beforeAll(async () => {
    f = await createStaffFixture();
    for (const login of ['owner-a', 'owner-b', 'senior-a', 'platform-admin']) {
      cookies[login] = await signIn(f.app, login, TEST_PASSWORD);
    }
    const db = f.t.admin.db;
    await db.update(orgSettings).set({ extApi: true });
    // «Старшему» в А — витрина с правом на токены, области — «Все» (токен выпускается только к шаблону,
    // который «Вывод» не отбирает по «Свои», п. Т-26): его токен — для «автор уволен».
    await db.insert(schema.rolePermissions).values(
      ['dmView', 'dmTokens'].map((permissionId) => ({
        orgId: f.a.orgId,
        roleId: f.roleIds.senior,
        permissionId,
      })),
    );
    await db
      .update(schema.roleScopes)
      .set({ scope: 'all' })
      .where(eq(schema.roleScopes.roleId, f.roleIds.senior));
    // Функция «Проекты» включена: шаблон модуля «Проекты» виден владельцу.
    await db
      .update(orgSettings)
      .set({ features: sql`${orgSettings.features} || '{"projects": true}'::jsonb` });
    const add = async (
      code: string,
      query: string,
      over: Partial<typeof dmTemplates.$inferInsert> = {},
    ) => {
      const [t] = await db
        .insert(dmTemplates)
        .values({ code, name: `Шаблон ${code}`, module: 'staff', state: 'published', ...over })
        .returning({ id: dmTemplates.id });
      await db.insert(dmTemplateSql).values({ templateId: t!.id, query });
    };
    await add(
      'ext-staff',
      "SELECT e.short_name AS name, 125050::bigint AS fee, NULL::bigint AS nofee, '=1+2' AS formula, :month AS month, e.id AS cp FROM employees e ORDER BY e.short_name",
      {
        params: [{ code: 'month', name: 'Месяц', type: 'month', required: true, default: 'month' }],
        columns: STAFF_COLUMNS,
      },
    );
    await add('ext-many', 'SELECT g AS n FROM generate_series(1, 2500) g ORDER BY g', {
      columns: [{ code: 'n', name: 'Номер', type: 'num', total: false, contractor: false }],
    });
    await add('ext-proj', 'SELECT 1 AS n', {
      module: 'projects',
      columns: [{ code: 'n', name: 'Номер', type: 'num', total: false, contractor: false }],
    });
    await add('ext-rep', 'SELECT 1 AS n', {
      module: 'cps',
      columns: [{ code: 'n', name: 'Номер', type: 'num', total: false, contractor: false }],
    });
    await add('ext-adm', 'SELECT count(*)::integer AS orgs FROM organizations', {
      audience: 'admin',
      module: null,
      columns: [
        { code: 'orgs', name: 'Организаций', type: 'num', total: false, contractor: false },
      ],
    });
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('JSON: строки организации токена, без столбца «Контрагент», деньги — сомами; чужая организация не видна', async () => {
    const a = await issue('owner-a', 'ext-staff', 'JSON А');
    const b = await issue('owner-b', 'ext-staff', 'JSON Б');
    const res = await ext('ext-staff?month=2026-11', { token: a.token });
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await answer(res);
    expect(body.columns).toEqual(
      STAFF_COLUMNS.filter((c) => c.type !== 'cp').map((c) => ({
        key: c.code,
        title: c.name,
        type: c.type,
      })),
    );
    const names = async (orgId: string) =>
      (
        await f.t.admin.db
          .select({ n: schema.employees.shortName })
          .from(schema.employees)
          .where(eq(schema.employees.orgId, orgId))
      )
        .map((r) => r.n)
        .sort();
    expect(body.rows.map((r) => r.name).sort()).toEqual(await names(f.a.orgId));
    expect(body.total).toBe(body.rows.length);
    expect(body.next).toBeNull();
    expect(body.rows[0]).toEqual({
      name: body.rows[0]!.name,
      fee: 1250.5,
      nofee: 0,
      formula: '=1+2',
      month: '2026-11',
    });
    const ofB = await answer(await ext('ext-staff?month=2026-11', { token: b.token }));
    expect(ofB.rows.map((r) => r.name).sort()).toEqual(await names(f.b.orgId));
    expect(ofB.rows.map((r) => r.name)).not.toContain(
      body.rows.find((r) => !ofB.rows.some((x) => x.name === r.name))?.name ?? '—',
    );
    // Те же строки, что владелец видит в «Выводе» этого шаблона.
    const shown = await apiRequest(f.app, 'POST', '/api/dm/output/run', cookies['owner-a'], {
      code: 'ext-staff',
      params: { month: '2026-11' },
    });
    expect(shown.status, await shown.clone().text()).toBe(200);
    const out = DmRunResult.parse(await shown.json());
    const at = out.columns.findIndex((c) => c.code === 'name');
    expect(body.rows.map((r) => r.name)).toEqual(out.rows.map((r) => r[at]));
    // Без параметра — значение по умолчанию (текущий месяц), лишние параметры отбрасываются.
    const def = await answer(await ext('ext-staff?zzz=1', { token: a.token }));
    expect(def.rows[0]!.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('CSV: таблица с названиями столбцов, метка UTF-8, формула — с апострофом', async () => {
    const a = await issue('owner-a', 'ext-staff', 'CSV');
    const res = await ext('ext-staff?month=2026-11&format=csv', { token: a.token });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Метка UTF-8 (BOM) — первые три байта; `TextDecoder` её снимает.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('Сотрудник,Сумма,Без суммы,Формула,Месяц\r\n')).toBe(true);
    expect(text).toContain(",1250.5,0,'=1+2,2026-11\r\n");
  });

  it('страницы: 1 000 строк, ссылка на следующую, до 5 000 с limit; неверная страница — «Неверный параметр»', async () => {
    const a = await issue('owner-a', 'ext-many', 'Страницы');
    const first = await answer(await ext('ext-many', { token: a.token }));
    expect(first.rows.length).toBe(1000);
    expect(first.total).toBe(2500);
    expect(first.next).toBe('http://localhost:3000/api/ext/v1/ext-many?page=2');
    const last = await answer(await ext('ext-many?page=3', { token: a.token }));
    expect(last.rows.map((r) => r.n)).toEqual(Array.from({ length: 500 }, (_, i) => 2001 + i));
    expect(last.next).toBeNull();
    const all = await answer(await ext('ext-many?limit=5000', { token: a.token }));
    expect(all.rows.length).toBe(2500);
    const big = await answer(await ext('ext-many?limit=2000', { token: a.token }));
    expect(big.next).toBe('http://localhost:3000/api/ext/v1/ext-many?limit=2000&page=2');
    for (const q of ['limit=5001', 'page=0', 'page=x', 'format=xml', 'page=1&page=2']) {
      const e = await expectErr(
        await ext(`ext-many?${q}`, { token: a.token }),
        400,
        'dm_ext_param',
      );
      expect(e.message).toMatch(/^Неверный параметр: (limit|page|format)$/);
    }
  });

  it('параметры по типам: неверный месяц — «Неверный параметр: month», в журнале — итог и параметры', async () => {
    const a = await issue('owner-a', 'ext-staff', 'Параметры');
    const e = await expectErr(
      await ext('ext-staff?month=2026-13', { token: a.token }),
      400,
      'dm_ext_param',
    );
    expect(e.message).toBe('Неверный параметр: month');
    const [row] = await logOf(a.item.id);
    expect(row).toMatchObject({ outcome: 'bad_param', params: { month: '2026-13' }, via: 'api' });
  });

  it('токен только в заголовке; другой шаблон, неизвестный токен, cookie вместо токена — «Токен не подходит или истёк»', async () => {
    const a = await issue('owner-a', 'ext-staff', 'Заголовок');
    const ip = nextIp();
    for (const q of [`token=${a.token}`, `x=${a.token}`, 'access_token=abc', 'api_key=1']) {
      await expectErr(await ext(`ext-staff?${q}`, { ip }), 400, 'dm_ext_token_in_url');
    }
    const other = await expectErr(
      await ext('ext-many', { token: a.token, ip }),
      401,
      'dm_ext_token',
    );
    expect(other.message).toBe(txt('err.dm_ext_token'));
    await expectErr(await ext('ext-no-such', { token: a.token, ip }), 401, 'dm_ext_token');
    const none = await ext('ext-staff', { ip, cookie: cookies['owner-a'] });
    await expectErr(none, 401, 'dm_ext_token');
    expect(none.headers.get('www-authenticate')).toBe('Bearer');
    const fake = `bk_${'A'.repeat(43)}`;
    await expectErr(await ext('ext-staff', { token: fake, ip }), 401, 'dm_ext_token');
    await expectErr(await ext('ext-staff', { token: 'bk_short', ip }), 401, 'dm_ext_token');
    // Другой шаблон по известному токену — в журнале токена.
    expect((await logOf(a.item.id)).map((r) => r.outcome)).toEqual(['denied', 'denied']);
  });

  it('по токену ничего не изменить: другие методы не отвечают данными, токены и шаблоны те же', async () => {
    const a = await issue('owner-a', 'ext-staff', 'Только чтение');
    const before = await f.t.admin.db.select().from(dmTokens).where(eq(dmTokens.id, a.item.id));
    for (const method of ['POST', 'PUT'] as const) {
      const res = await ext('ext-staff', { token: a.token, method });
      expect([403, 404, 405]).toContain(res.status);
    }
    const after = await f.t.admin.db.select().from(dmTokens).where(eq(dmTokens.id, a.item.id));
    expect(after).toEqual(before);
  });

  it(`пределы токена: ${DM_EXT_PER_MINUTE + 1}-й запрос за минуту — «Слишком часто, повторите через N секунд»`, async () => {
    const a = await issue('owner-a', 'ext-proj', 'Частота');
    for (let i = 0; i < DM_EXT_PER_MINUTE; i++) {
      expect((await ext('ext-proj', { token: a.token })).status).toBe(200);
    }
    const res = await ext('ext-proj', { token: a.token });
    const e = await expectErr(res, 429, 'dm_ext_rate');
    const wait = Number(res.headers.get('retry-after'));
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(60);
    expect(e.message).toBe(`Слишком часто, повторите через ${wait} секунд`);
    const log = await logOf(a.item.id);
    expect(log.filter((r) => r.outcome === 'ok')).toHaveLength(DM_EXT_PER_MINUTE);
    expect(log.at(-1)).toMatchObject({ outcome: 'rate', error: e.message });
  });

  it('«Отозвать» — следующий запрос «Токен не подходит»; «Перевыпустить» — новый работает сразу, старый ещё сутки', async () => {
    const a = await issue('owner-a', 'ext-proj', 'Отзыв');
    expect((await ext('ext-proj', { token: a.token })).status).toBe(200);
    await apiRequest(f.app, 'POST', `/api/dm/tokens/${a.item.id}/revoke`, cookies['owner-a']);
    await expectErr(await ext('ext-proj', { token: a.token }), 401, 'dm_ext_token');
    const old = await issue('owner-a', 'ext-proj', 'Перевыпуск');
    const re = await apiRequest(
      f.app,
      'POST',
      `/api/dm/tokens/${old.item.id}/reissue`,
      cookies['owner-a'],
    );
    const made = DmTokenIssued.parse(await re.json());
    expect((await ext('ext-proj', { token: made.token })).status).toBe(200);
    expect((await ext('ext-proj', { token: old.token })).status).toBe(200);
    // Сутки прошли (правило базы не даёт менять перевыпуск — только мимо триггеров, как при восстановлении).
    await f.t.admin.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx
        .update(dmTokens)
        .set({ graceUntil: sql`now() - interval '1 second'` })
        .where(eq(dmTokens.id, old.item.id));
    });
    await expectErr(await ext('ext-proj', { token: old.token }), 401, 'dm_ext_token');
  });

  it('«Доступ остановлен»: внешний доступ выключен, подписка, блокировка, шаблон выключен, функция модуля; потом снова работает', async () => {
    const a = await issue('owner-a', 'ext-proj', 'Остановки');
    const db = f.t.admin.db;
    const stopped = async () => {
      const e = await expectErr(await ext('ext-proj', { token: a.token }), 403, 'dm_ext_stopped');
      expect(e.message).toBe('Доступ остановлен');
    };
    const works = async () => expect((await ext('ext-proj', { token: a.token })).status).toBe(200);
    const inA = eq(orgSettings.orgId, f.a.orgId);
    await db.update(orgSettings).set({ extApi: false }).where(inA);
    await stopped();
    await db.update(orgSettings).set({ extApi: true }).where(inA);
    await works();
    const sub = eq(schema.orgSubscriptions.orgId, f.a.orgId);
    await db.update(schema.orgSubscriptions).set({ paidUntil: '2020-01-31' }).where(sub);
    await stopped();
    await db.update(schema.orgSubscriptions).set({ paidUntil: '2099-12-31' }).where(sub);
    await works();
    await db
      .update(organizations)
      .set({ status: 'blocked' })
      .where(eq(organizations.id, f.a.orgId));
    await stopped();
    await db.update(organizations).set({ status: 'active' }).where(eq(organizations.id, f.a.orgId));
    await works();
    const tpl = eq(dmTemplates.code, 'ext-proj');
    await db.update(dmTemplates).set({ state: 'off' }).where(tpl);
    await stopped();
    await db.update(dmTemplates).set({ state: 'published' }).where(tpl);
    // Функция «Проекты» выключена — шаблон модуля не виден даже владельцу.
    const [s] = await db.select({ features: orgSettings.features }).from(orgSettings).where(inA);
    const features = (s?.features ?? {}) as Record<string, boolean>;
    await db
      .update(orgSettings)
      .set({ features: { ...features, projects: false } })
      .where(inA);
    await stopped();
    await db
      .update(orgSettings)
      .set({ features: { ...features, projects: true } })
      .where(inA);
    await works();
    expect((await logOf(a.item.id)).filter((r) => r.outcome === 'closed')).toHaveLength(5);
  });

  it('шаблон сломан или запрос не выполнился — «Шаблон временно не работает»', async () => {
    const a = await issue('owner-a', 'ext-proj', 'Сломан');
    const db = f.t.admin.db;
    const tpl = eq(dmTemplates.code, 'ext-proj');
    await db.update(dmTemplates).set({ state: 'broken' }).where(tpl);
    const e = await expectErr(await ext('ext-proj', { token: a.token }), 503, 'dm_ext_broken');
    expect(e.message).toBe('Шаблон временно не работает');
    await db.update(dmTemplates).set({ state: 'published' }).where(tpl);
    const [row] = await db.select({ id: dmTemplates.id }).from(dmTemplates).where(tpl);
    const q = eq(dmTemplateSql.templateId, row!.id);
    await db.update(dmTemplateSql).set({ query: 'SELECT n FROM no_such_table' }).where(q);
    try {
      await expectErr(await ext('ext-proj', { token: a.token }), 503, 'dm_ext_broken');
    } finally {
      await db.update(dmTemplateSql).set({ query: 'SELECT 1 AS n' }).where(q);
    }
    // Сломан по отметке — отказ до запуска; не выполнился — исход запуска «Ошибка» (общий путь «Вывода»).
    expect((await logOf(a.item.id)).map((r) => r.outcome)).toEqual(['broken', 'error']);
  });

  it('токен Админки: шаблон «Для администратора» по всем организациям; шаблон организаций им не открыть', async () => {
    const adm = await issue('platform-admin', 'ext-adm', 'Сводка', '/api/admin/dm');
    const body = await answer(await ext('ext-adm', { token: adm.token }));
    const [n] = await f.t.admin.db.select({ n: sql<number>`count(*)::int` }).from(organizations);
    expect(body.rows).toEqual([{ orgs: n!.n }]);
    await expectErr(await ext('ext-staff', { token: adm.token }), 401, 'dm_ext_token');
    const [row] = await logOf(adm.item.id);
    expect(row).toMatchObject({ orgId: null, outcome: 'ok', rowCount: 1 });
  });

  it('20 неизвестных токенов с одного адреса за 10 минут — адрес ждёт, даже с верным токеном; другой адрес — нет', async () => {
    const a = await issue('owner-a', 'ext-proj', 'Перебор');
    const ip = nextIp();
    for (let i = 0; i < 20; i++) {
      const fake = `bk_${String(i).padStart(43, 'B')}`;
      await expectErr(await ext('ext-proj', { token: fake, ip }), 401, 'dm_ext_token');
    }
    const res = await ext('ext-proj', { token: a.token, ip });
    await expectErr(res, 429, 'dm_ext_rate');
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(500);
    expect((await ext('ext-proj', { token: a.token, ip: nextIp() })).status).toBe(200);
    // Отозванный и истёкший токен — известный: в счёт адреса не идёт.
    const ip2 = nextIp();
    const gone = await issue('owner-a', 'ext-proj', 'Отозванный');
    await apiRequest(f.app, 'POST', `/api/dm/tokens/${gone.item.id}/revoke`, cookies['owner-a']);
    for (let i = 0; i < 25; i++) {
      await expectErr(await ext('ext-proj', { token: gone.token, ip: ip2 }), 401, 'dm_ext_token');
    }
    expect((await ext('ext-proj', { token: a.token, ip: ip2 })).status).toBe(200);
  });

  it('автор уволен — токен работает: строки организации, в журнале «Успешно» (блок 5, пункт 7)', async () => {
    const made = await issue('senior-a', 'ext-rep', 'Токен уволенного');
    const db = f.t.admin.db;
    const senior = f.people['senior-a']!;
    await db
      .update(schema.employees)
      .set({ active: false })
      .where(eq(schema.employees.id, senior.employeeId));
    try {
      const body = await answer(await ext('ext-rep', { token: made.token }));
      expect(body.rows).toEqual([{ n: 1 }]);
      expect((await logOf(made.item.id)).map((r) => r.outcome)).toEqual(['ok']);
    } finally {
      await db
        .update(schema.employees)
        .set({ active: true })
        .where(eq(schema.employees.id, senior.employeeId));
    }
  });

  it(`запуски по токенам платформы заняты (${DM_EXT_RUNS_PLATFORM}) — запрос ждёт, потом «Слишком часто»; освободились — работает`, async () => {
    const a = await issue('owner-a', 'ext-proj', 'Очередь');
    const db = f.t.admin.db;
    // Все места запусков по токенам платформы заняты чужими (строки, как их ставит app.dm_ext_take).
    const busy = await db
      .insert(rateLimits)
      .values(
        Array.from({ length: DM_EXT_RUNS_PLATFORM }, (_, i) => ({
          kind: 'dm_ext_run',
          subject: `admin:busy-${i}`,
          busyUntil: sql`now() + interval '1 minute'`,
        })),
      )
      .returning({ id: rateLimits.id });
    try {
      const started = Date.now();
      const res = await ext('ext-proj', { token: a.token });
      const e = await expectErr(res, 429, 'dm_ext_rate');
      expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
      expect(res.headers.get('retry-after')).toBe('1');
      expect(e.message).toBe('Слишком часто, повторите через 1 секунд');
      expect((await logOf(a.item.id)).map((r) => r.outcome)).toEqual(['rate']);
    } finally {
      for (const r of busy) await db.delete(rateLimits).where(eq(rateLimits.id, r.id));
    }
    expect((await ext('ext-proj', { token: a.token })).status).toBe(200);
    // Свой запуск отпущен: строк запусков не осталось.
    const left = await db.select().from(rateLimits).where(eq(rateLimits.kind, 'dm_ext_run'));
    expect(left).toHaveLength(0);
  });

  it('места запусков «Витрины» всего сайта заняты «Выводом» — «Слишком часто» с Retry-After и строкой журнала', async () => {
    const a = await issue('owner-a', 'ext-proj', 'Сайт занят');
    const db = f.t.admin.db;
    // Оба места сайта (`withDmPoolSlot`, `dm_run_all`) заняты чужими запусками.
    const busy = await db
      .insert(rateLimits)
      .values(
        ['slot:0', 'slot:1'].map((subject) => ({
          kind: 'dm_run_all',
          subject,
          busyUntil: sql`now() + interval '1 minute'`,
        })),
      )
      .returning({ id: rateLimits.id });
    try {
      const res = await ext('ext-proj', { token: a.token });
      await expectErr(res, 429, 'dm_ext_rate');
      expect(res.headers.get('retry-after')).toBe('1');
      expect((await logOf(a.item.id)).map((r) => r.outcome)).toEqual(['rate']);
    } finally {
      for (const r of busy) await db.delete(rateLimits).where(eq(rateLimits.id, r.id));
    }
    expect((await ext('ext-proj', { token: a.token })).status).toBe(200);
    // Своё место очереди внешнего адреса отпущено и после отказа сайта.
    const left = await db.select().from(rateLimits).where(eq(rateLimits.kind, 'dm_ext_run'));
    expect(left).toHaveLength(0);
  });

  it(`известный токен: ${DM_EXT_TRY_PER_MINUTE + 1}-е обращение за минуту — «Слишком часто» и без отказа; в журнале — ${DM_EXT_REFUSAL_LOGS_PER_MINUTE} отказов`, async () => {
    const gone = await issue('owner-a', 'ext-proj', 'Отозванный часто');
    await apiRequest(f.app, 'POST', `/api/dm/tokens/${gone.item.id}/revoke`, cookies['owner-a']);
    const ip = nextIp();
    for (let i = 0; i < DM_EXT_TRY_PER_MINUTE; i++) {
      await expectErr(await ext('ext-proj', { token: gone.token, ip }), 401, 'dm_ext_token');
    }
    const res = await ext('ext-proj', { token: gone.token, ip });
    await expectErr(res, 429, 'dm_ext_rate');
    const wait = Number(res.headers.get('retry-after'));
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(60);
    const log = await logOf(gone.item.id);
    expect(log).toHaveLength(DM_EXT_REFUSAL_LOGS_PER_MINUTE);
    expect(log.every((r) => r.outcome === 'denied')).toBe(true);
    // Адрес при этом не ждёт: у другого токена с него — ответ.
    const a = await issue('owner-a', 'ext-proj', 'Сосед');
    expect((await ext('ext-proj', { token: a.token, ip })).status).toBe(200);
  });

  it('журнал: адрес, строки, время и итог; «Последний запрос» токена; окно токена — только своей организации', async () => {
    const a = await issue('owner-a', 'ext-staff', 'Журнал');
    const ip = nextIp();
    const body = await answer(await ext('ext-staff?month=2026-10', { token: a.token, ip }));
    const [row] = await logOf(a.item.id);
    expect(row).toMatchObject({
      orgId: f.a.orgId,
      via: 'api',
      outcome: 'ok',
      params: { month: '2026-10' },
      rowCount: body.total,
      ip,
      error: null,
    });
    expect(row!.durationMs).toBeGreaterThanOrEqual(0);
    const card = DmTokenCard.parse(
      await (
        await apiRequest(f.app, 'GET', `/api/dm/tokens/${a.item.id}`, cookies['owner-a'])
      ).json(),
    );
    expect(card.log.items[0]).toMatchObject({ params: 'month=2026-10', ok: true, ip });
    expect(card.lastIp).toBe(ip);
    const ofB = await apiRequest(f.app, 'GET', `/api/dm/tokens/${a.item.id}`, cookies['owner-b']);
    expect(ofB.status).toBe(404);
    const [token] = await f.t.admin.db
      .select({ lastIp: dmTokens.lastIp, lastUsedAt: dmTokens.lastUsedAt })
      .from(dmTokens)
      .where(and(eq(dmTokens.id, a.item.id)));
    expect(token).toMatchObject({ lastIp: ip });
    expect(token!.lastUsedAt).not.toBeNull();
    // Мусор в X-Forwarded-For в журнал не попадает: адреса нет.
    for (const junk of ['<script>alert(1)</script>', '1'.repeat(500)]) {
      await answer(await ext('ext-staff?month=2026-10', { token: a.token, ip: junk }));
    }
    expect((await logOf(a.item.id)).slice(1).map((r) => r.ip)).toEqual([null, null]);
  });
  it('«Как подключить»: адрес с параметрами по умолчанию и столбцы без «Контрагента» — у своего живого токена', async () => {
    const a = await issue('owner-a', 'ext-staff', 'Как подключить');
    // «Сегодня» — по часам приложения (в тестах — 18.10.2026).
    const month = bishkekDate(new Date('2026-10-18T03:00:00Z')).slice(0, 7);
    expect(a.item.how).toEqual({
      url: `http://localhost:3000/api/ext/v1/ext-staff?month=${month}`,
      columns: STAFF_COLUMNS.filter((c) => c.type !== 'cp').map((c) => ({
        key: c.code,
        title: c.name,
        type: c.type,
      })),
    });
    // Администратору платформы токен организации — без «Как подключить» (не его токен).
    const seen = DmTokenCard.parse(
      await (
        await apiRequest(
          f.app,
          'GET',
          `/api/admin/dm/tokens/${a.item.id}`,
          cookies['platform-admin'],
        )
      ).json(),
    );
    expect(seen.how).toBeNull();
    const revoked = DmTokenCard.parse(
      await (
        await apiRequest(f.app, 'POST', `/api/dm/tokens/${a.item.id}/revoke`, cookies['owner-a'])
      ).json(),
    );
    expect(revoked.how).toBeNull();
    const adm = await issue('platform-admin', 'ext-adm', 'Как подключить', '/api/admin/dm');
    expect(adm.item.how?.url).toBe('http://localhost:3000/api/ext/v1/ext-adm');
  });

  it('Админка → «Журнал запросов»: только запросы по токенам всех организаций, плашки; другим — 403', async () => {
    const a = await issue('owner-a', 'ext-staff', 'Журнал Админки');
    const ip = nextIp();
    await answer(await ext('ext-staff?month=2026-09', { token: a.token, ip }));
    // Свои запросы Б и Админки — в этом же тесте: журнал не держится на соседних.
    const b = await issue('owner-b', 'ext-proj', 'Журнал Админки Б');
    await answer(await ext('ext-proj', { token: b.token, ip }));
    const adm = await issue('platform-admin', 'ext-adm', 'Журнал Админки', '/api/admin/dm');
    await answer(await ext('ext-adm', { token: adm.token, ip }));
    await expectErr(await ext('ext-staff?page=0', { token: a.token, ip }), 400, 'dm_ext_param');
    const list = async (q = '') => {
      const res = await apiRequest(
        f.app,
        'GET',
        `/api/admin/dm/requests${q}`,
        cookies['platform-admin'],
      );
      expect(res.status, await res.clone().text()).toBe(200);
      return DmRequestList.parse(await res.json());
    };
    const all = await list('?size=all');
    const mine = all.items.filter((x) => x.tokenId === a.item.id);
    expect(mine.map((x) => [x.ok, x.params, x.ip, x.orgName, x.tokenName])).toEqual([
      [false, '', ip, 'Организация А', 'Журнал Админки'],
      [true, 'month=2026-09', ip, 'Организация А', 'Журнал Админки'],
    ]);
    expect(mine[0]!.error).toBe('Неверный параметр: page');
    expect(new Set(all.items.map((x) => x.orgName))).toEqual(
      new Set(['Организация А', 'Организация Б', txt('dm.tok.who_admin')]),
    );
    const errors = await list(
      `?filters=${encodeURIComponent(JSON.stringify({ res: { type: 'enum', vals: ['err'] } }))}`,
    );
    expect(errors.items.every((x) => !x.ok)).toBe(true);
    const sum = DmRequestSummary.parse(
      await (
        await apiRequest(f.app, 'GET', '/api/admin/dm/requests/summary', cookies['platform-admin'])
      ).json(),
    );
    expect(sum.today).toBeGreaterThanOrEqual(2);
    expect(sum.errors).toBeGreaterThanOrEqual(1);
    expect(sum.tokens).toBeGreaterThanOrEqual(1);
    const values = await apiRequest(
      f.app,
      'GET',
      '/api/admin/dm/requests/values?col=res',
      cookies['platform-admin'],
    );
    expect(values.status).toBe(200);
    const file = await apiRequest(
      f.app,
      'GET',
      '/api/admin/dm/requests/export?cols=at,res,org,tok',
      cookies['platform-admin'],
    );
    expect(file.status).toBe(200);
    // Неизвестный столбец в сортировке, значениях или файле — неверный запрос.
    for (const path of ['?sort=secret.asc', '/values?col=secret', '/export?cols=secret']) {
      const res = await apiRequest(
        f.app,
        'GET',
        `/api/admin/dm/requests${path}`,
        cookies['platform-admin'],
      );
      expect(res.status, path).toBe(400);
      expect(ApiError.parse(await res.json()).error.code).toBe('validation_failed');
    }
    for (const path of ['', '/summary', '/values?col=res', '/export?cols=at']) {
      const res = await apiRequest(
        f.app,
        'GET',
        `/api/admin/dm/requests${path}`,
        cookies['owner-a'],
      );
      expect(res.status).toBe(403);
    }
  });
});
