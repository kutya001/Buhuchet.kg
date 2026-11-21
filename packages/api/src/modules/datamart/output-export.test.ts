import { releaseRateLimit, schema, takeRateLimit } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSheetRows } from '../../lists/xlsx-read';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';
import { DM_RUN_RATE_LIMIT } from './output';
import { DM_RUN_ALL_LIMIT, DM_RUN_SLOTS } from './run';

/*
 * «Витрина данных» → «Вывод» → «В Excel» (доработки 20.11.2026: Витрина данных, блок 4, пункт 5; общий
 * план 20.11, этап 2, П6): права «Смотреть витрину данных» и «Выгружать в Excel», изоляция организаций,
 * область «Свои контрагенты», фильтры и столбцы таблицы, отказы запуска, «глазами организации» в
 * Админке.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const { auditLog, contractors, dmRequests, dmTemplates, dmTemplateSql, rateLimits } = schema;

const col = (code: string, type = 'text', extra: Record<string, unknown> = {}) => ({
  code,
  name: `Столбец ${code}`,
  type,
  total: false,
  contractor: false,
  ...extra,
});
const cpCol = col('contractor_id', 'cp', { contractor: true });

describe.skipIf(!databaseAvailable())('Витрина данных: «Вывод» → «В Excel»', () => {
  let f: Fixture;
  const cookies: Record<string, string> = {};
  const tpl: Record<string, string> = {};

  const call = (login: string | null, path: string, body: unknown) =>
    apiRequest(f.app, 'POST', path, login ? cookies[login] : undefined, body);
  const list = (over: Record<string, string> = {}) => ({ cols: 'name,fee', ...over });
  const exportOrg = (login: string | null, body: Record<string, unknown>) =>
    call(login, '/api/dm/output/export', { params: {}, list: list(), ...body });
  const exportAdmin = (body: Record<string, unknown>) =>
    call('platform-admin', '/api/admin/dm/output/export', { params: {}, list: list(), ...body });
  const sheet = async (res: Response) => {
    expect(res.status, res.status === 200 ? '' : await res.clone().text()).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    return readSheetRows(Buffer.from(await res.arrayBuffer()));
  };
  const fail = async (res: Response, status: number) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return ((await res.json()) as { error: { code: string; details?: unknown } }).error;
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    for (const login of ['owner-a', 'senior-a', 'acc-a', 'owner-b', 'platform-admin']) {
      cookies[login] = await signIn(f.app, login, TEST_PASSWORD);
    }
    const db = f.t.admin.db;
    await seedAllPlatformDictionaries(db);
    // «Старший» в А: «Просматривать контрагентов» и «Смотреть витрину данных», область — «Свои».
    await db
      .insert(schema.rolePermissions)
      .values({ orgId: f.a.orgId, roleId: f.roleIds.senior, permissionId: 'dmView' });
    let n = 0;
    const addCp = async (orgId: string, name: string, responsible: string | null) => {
      n += 1;
      await db.insert(contractors).values({
        orgId,
        name,
        inn: `0${String(n).padStart(13, '8')}`,
        phone: '+996505890076',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        startDate: '2026-07-01',
        responsibleEmployeeId: responsible,
      });
    };
    await addCp(f.a.orgId, 'Альфа', f.people['senior-a']!.employeeId);
    await addCp(f.a.orgId, 'Бета', f.people['acc-a']!.employeeId);
    await addCp(f.a.orgId, 'Вега', null);
    await addCp(f.b.orgId, 'Гамма', null);

    const add = async (
      code: string,
      query: string,
      over: Partial<typeof dmTemplates.$inferInsert> = {},
    ) => {
      const [t] = await db
        .insert(dmTemplates)
        .values({ code, name: `Шаблон ${code}`, module: 'cps', state: 'published', ...over })
        .returning({ id: dmTemplates.id });
      tpl[code] = t!.id;
      await db.insert(dmTemplateSql).values({ templateId: t!.id, query });
    };
    await add(
      'xl-cps',
      `select c.id as contractor_id, c.name as name,
         (case when c.name = 'Бета' then 250000 else 125050 end)::bigint as fee
       from contractors c order by c.name`,
      { columns: [col('name'), cpCol, col('fee', 'money', { total: true })] },
    );
    await add('xl-month', 'select :month as name, 1::bigint as fee', {
      columns: [col('name'), col('fee', 'money')],
      params: [{ code: 'month', name: 'Месяц', type: 'month', required: true, default: 'month' }],
    });
    await add('xl-broken', 'select 1 as name', { state: 'broken', columns: [col('name')] });
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('права: без «Смотреть витрину данных» или «Выгружать в Excel» — 403, без входа — 401; Админка — только администратору платформы', async () => {
    expect((await exportOrg('acc-a', { code: 'xl-cps' })).status).toBe(403);
    // «Старший» видит витрину, но выгружать в Excel не может.
    expect((await exportOrg('senior-a', { code: 'xl-cps' })).status).toBe(403);
    expect((await exportOrg(null, { code: 'xl-cps' })).status).toBe(401);
    expect((await exportOrg('platform-admin', { code: 'xl-cps' })).status).toBe(403);
    expect(
      (
        await call('owner-a', '/api/admin/dm/output/export', {
          code: 'xl-cps',
          params: {},
          list: list(),
        })
      ).status,
    ).toBe(403);
  });

  it('файл: строки своей организации, столбцы — видимые по порядку экрана, деньги — сомами; журнал', async () => {
    const before = await f.t.admin.db
      .select({ id: dmRequests.id })
      .from(dmRequests)
      .where(eq(dmRequests.templateId, tpl['xl-cps']!));
    const res = await exportOrg('owner-a', { code: 'xl-cps', list: list({ cols: 'fee,name' }) });
    expect(res.headers.get('x-export-rows')).toBe('3');
    expect(res.headers.get('x-export-more')).toBe('0');
    const rows = await sheet(res);
    expect(rows[0]).toEqual(['Столбец fee', 'Столбец name']);
    expect(rows.slice(1).map((r) => r[1])).toEqual(['Альфа', 'Бета', 'Вега']);
    expect(rows[1]![0]).toBe(1250.5);
    expect(JSON.stringify(rows)).not.toContain('Гамма');
    // Каждая выгрузка — строка журнала, как «Показать».
    const after = await f.t.admin.db
      .select({ id: dmRequests.id })
      .from(dmRequests)
      .where(eq(dmRequests.templateId, tpl['xl-cps']!));
    expect(after.length).toBe(before.length + 1);
    // Другая организация — только свои строки.
    const b = await sheet(await exportOrg('owner-b', { code: 'xl-cps' }));
    expect(b.slice(1).map((r) => r[0])).toEqual(['Гамма']);
  });

  it('фильтры, поиск и сортировка таблицы — те же, что на экране', async () => {
    const sorted = await sheet(
      await exportOrg('owner-a', { code: 'xl-cps', list: list({ sort: 'fee.desc' }) }),
    );
    expect(sorted.slice(1).map((r) => r[0])).toEqual(['Бета', 'Альфа', 'Вега']);
    const found = await sheet(
      await exportOrg('owner-a', { code: 'xl-cps', list: list({ q: 'вег', qcols: 'name' }) }),
    );
    expect(found.slice(1).map((r) => r[0])).toEqual(['Вега']);
    const filtered = await sheet(
      await exportOrg('owner-a', {
        code: 'xl-cps',
        list: list({ filters: JSON.stringify({ name: { type: 'text', q: 'бет' } }) }),
      }),
    );
    expect(filtered.slice(1).map((r) => r[0])).toEqual(['Бета']);
  });

  it('область «Свои»: только строки своих контрагентов', async () => {
    await f.t.admin.db
      .insert(schema.rolePermissions)
      .values({ orgId: f.a.orgId, roleId: f.roleIds.senior, permissionId: 'export' });
    try {
      const rows = await sheet(await exportOrg('senior-a', { code: 'xl-cps' }));
      expect(rows.slice(1).map((r) => r[0])).toEqual(['Альфа']);
    } finally {
      await f.t.admin.db
        .delete(schema.rolePermissions)
        .where(
          and(
            eq(schema.rolePermissions.roleId, f.roleIds.senior),
            eq(schema.rolePermissions.permissionId, 'export'),
          ),
        );
    }
  });

  it('отказы: неизвестный или служебный столбец и неверный запрос списка — 400, параметр — `dm_bad_param`, сломанный — 409, чужой код — 404', async () => {
    expect(
      (
        await fail(
          await exportOrg('owner-a', { code: 'xl-cps', list: list({ cols: 'name,x' }) }),
          400,
        )
      ).code,
    ).toBe('validation_failed');
    expect(
      (
        await fail(
          await exportOrg('owner-a', { code: 'xl-cps', list: list({ cols: 'contractor_id' }) }),
          400,
        )
      ).code,
    ).toBe('validation_failed');
    expect(
      (
        await fail(
          await exportOrg('owner-a', { code: 'xl-cps', list: list({ filters: '{' }) }),
          400,
        )
      ).code,
    ).toBe('validation_failed');
    // Сортировка, фильтр, поиск и группа — только по столбцам вывода (служебный «Контрагент» — тоже нет).
    const unknown: Record<string, string>[] = [
      { sort: 'x.asc' },
      { filters: JSON.stringify({ x: { type: 'text', q: 'а' } }) },
      { q: 'а', qcols: 'name,contractor_id' },
      { group: 'x' },
    ];
    for (const over of unknown) {
      expect(
        (await fail(await exportOrg('owner-a', { code: 'xl-cps', list: list(over) }), 400)).code,
        JSON.stringify(over),
      ).toBe('validation_failed');
    }
    const bad = await fail(
      await exportOrg('owner-a', {
        code: 'xl-month',
        params: { month: '2026-13' },
        list: list({ cols: 'name' }),
      }),
      400,
    );
    expect(bad).toMatchObject({ code: 'dm_bad_param', details: { param: 'month', why: 'type' } });
    const broken = await fail(
      await exportOrg('owner-a', { code: 'xl-broken', list: list({ cols: 'name' }) }),
      409,
    );
    expect(broken.code).toBe('dm_template_broken');
    // Текст базы — только Админке.
    expect(broken.details).toBeUndefined();
    expect((await fail(await exportOrg('owner-a', { code: 'xl-none' }), 404)).code).toBe(
      'dm_template_not_found',
    );
  });

  it('идёт «Показать» того же человека — 429 «Предыдущий запрос ещё выполняется», выгрузка из 20 в час не тратится', async () => {
    const exportsOf = async () =>
      (
        await f.t.admin.db
          .select({ n: sql<number>`count(*)::int` })
          .from(rateLimits)
          .where(and(eq(rateLimits.kind, 'export'), eq(rateLimits.subject, f.a.ownerUserId)))
      )[0]!.n;
    const before = await exportsOf();
    const slot = await takeRateLimit(f.t.app.db, DM_RUN_RATE_LIMIT, f.a.ownerUserId);
    if (!slot.ok) throw new Error('место запуска свободно');
    try {
      expect((await fail(await exportOrg('owner-a', { code: 'xl-cps' }), 429)).code).toBe(
        'dm_busy',
      );
      expect(await exportsOf()).toBe(before);
    } finally {
      await releaseRateLimit(f.t.app.db, DM_RUN_RATE_LIMIT, f.a.ownerUserId, slot.ticket);
    }
    await sheet(await exportOrg('owner-a', { code: 'xl-cps' }));
    expect(await exportsOf()).toBe(before + 1);
  });

  it('пул запусков сайта занят — 429 `dm_busy_all`, выгрузка из 20 в час не тратится (п. О-96)', async () => {
    const exportsOf = async () =>
      (
        await f.t.admin.db
          .select({ n: sql<number>`count(*)::int` })
          .from(rateLimits)
          .where(and(eq(rateLimits.kind, 'export'), eq(rateLimits.subject, f.a.ownerUserId)))
      )[0]!.n;
    const before = await exportsOf();
    const held: { subject: string; ticket: number }[] = [];
    try {
      for (let i = 0; i < DM_RUN_SLOTS; i += 1) {
        const subject = `slot:${i}`;
        const slot = await takeRateLimit(f.t.app.db, DM_RUN_ALL_LIMIT, subject);
        if (!slot.ok) throw new Error(`место пула ${subject} свободно`);
        held.push({ subject, ticket: slot.ticket });
      }
      expect((await fail(await exportOrg('owner-a', { code: 'xl-cps' }), 429)).code).toBe(
        'dm_busy_all',
      );
      expect(await exportsOf()).toBe(before);
    } finally {
      for (const h of held) {
        await releaseRateLimit(f.t.app.db, DM_RUN_ALL_LIMIT, h.subject, h.ticket);
      }
    }
    // Место пула отпущено — выгрузка проходит и тратит одну из 20, место пула после неё свободно.
    await sheet(await exportOrg('owner-a', { code: 'xl-cps' }));
    expect(await exportsOf()).toBe(before + 1);
    const again = await takeRateLimit(f.t.app.db, DM_RUN_ALL_LIMIT, 'slot:0');
    expect(again.ok).toBe(true);
    if (again.ok) await releaseRateLimit(f.t.app.db, DM_RUN_ALL_LIMIT, 'slot:0', again.ticket);
  });

  it('Админка: шаблон организаций — только «глазами организации», открытие — в её историю', async () => {
    expect((await fail(await exportAdmin({ code: 'xl-cps' }), 400)).code).toBe('dm_org_required');
    const views = () =>
      f.t.admin.db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.orgId, f.b.orgId),
            eq(auditLog.entity, 'organization'),
            eq(auditLog.action, 'card_view'),
          ),
        );
    const before = (await views()).length;
    const rows = await sheet(await exportAdmin({ code: 'xl-cps', orgId: f.b.orgId }));
    expect(rows.slice(1).map((r) => r[0])).toEqual(['Гамма']);
    const after = await views();
    expect(after.length).toBe(before + 1);
    // Организация видит, что её данные выгрузили в файл, а не только открыли.
    const [last] = await f.t.admin.db
      .select({ reason: auditLog.reason })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.orgId, f.b.orgId),
          eq(auditLog.entity, 'organization'),
          eq(auditLog.action, 'card_view'),
        ),
      )
      .orderBy(desc(auditLog.at))
      .limit(1);
    expect(last?.reason).toBe(
      'Шаблон витрины данных «Шаблон xl-cps» выгружен в Excel глазами организации',
    );
  });
});
