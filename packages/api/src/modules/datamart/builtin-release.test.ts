import { randomUUID } from 'node:crypto';
import { hashPassword } from '@buhuchet/adapters/password';
import {
  dmParamDefsOf,
  runDmAdmin,
  runDmOrg,
  schema,
  type DmTemplateColumn,
  type DmTemplateParam,
} from '@buhuchet/db';
import { DEMO_ORG_ID, seedAll } from '@buhuchet/db/seed';
import {
  createTestDatabase,
  createTestDatabaseAt,
  databaseAvailable,
  type TestDatabase,
} from '@buhuchet/db/testing';
import { bishkekDate, dmBind } from '@buhuchet/domain';
import { DmCatalog, DmRunResult } from '@buhuchet/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import { apiRequest, createTestDeps, signIn, TEST_PASSWORD } from '../../testing';
import { dmCheckTemplatesJob } from './check-job';

/*
 * Этап 3, П4 общего плана 20.11 (задача-проверка потока К): готовые шаблоны «Витрины данных» на копии
 * данных стенда и на базе «до выпуска» (доработки 20.11.2026: Витрина данных, блок 7; блок 8, пункты
 * 7–8). К базе стенда тест не подключается: базу собирает так же, как её собирают выпуски.
 * - «Как стенд»: все миграции, `pnpm db:seed` с демо-организацией и поверх — `pnpm db:seed --update`
 *   (так CI собирает базу сквозных тестов, так же каждый выпуск на стенд обновляет уже наполненную базу).
 *   Шаблоны идут настоящими путями: «Вывод» владельца демо и Админки, «Проверка шаблонов» системой.
 * - «До выпуска»: база на 0164 (на ней рабочий сайт) с организациями, их сотрудниками и контрагентами,
 *   затем остальные миграции и `pnpm db:seed --update` без демо — как «Выпустить на рабочий сайт».
 *   Каждый шаблон организаций выполняется в контексте каждой организации и не видит чужих строк;
 *   «Проверка шаблонов» без демо идёт в пустом контексте и ни одного не ломает.
 */

const { dmTemplateSql, dmTemplates, organizations, orgSettings, users } = schema;

interface Builtin {
  id: string;
  code: string;
  audience: 'org' | 'admin';
  state: string;
  params: DmTemplateParam[];
  columns: DmTemplateColumn[];
  query: string;
}

/** 12 шаблонов организаций и 6 Админки из refDB.json (блок 7). */
const ORG_BUILTINS = 12;
const ADMIN_BUILTINS = 6;

async function builtinsOf(db: TestDatabase['admin']['db']): Promise<Map<string, Builtin>> {
  const rows = await db
    .select({
      id: dmTemplates.id,
      code: dmTemplates.code,
      audience: dmTemplates.audience,
      state: dmTemplates.state,
      params: dmTemplates.params,
      columns: dmTemplates.columns,
      query: dmTemplateSql.query,
    })
    .from(dmTemplates)
    .innerJoin(dmTemplateSql, eq(dmTemplateSql.templateId, dmTemplates.id))
    .where(eq(dmTemplates.builtin, true));
  return new Map(rows.map((r) => [r.code, r as Builtin]));
}

/** «Проверка шаблонов» системой до конца: за запуск — не больше 10, остальные — следующим. */
async function checkAll(deps: ApiDeps): Promise<number> {
  const job = dmCheckTemplatesJob();
  let total = 0;
  for (let i = 0; i < 5; i++) {
    const n = (await job.run(deps, deps.clock.now())) ?? 0;
    if (n === 0) return total;
    total += n;
  }
  throw new Error('проверка шаблонов не закончилась за 5 запусков');
}

describe.skipIf(!databaseAvailable())(
  'Этап 3, П4: готовые шаблоны «Витрины данных» на базе, собранной как у стенда (блок 7; блок 8, пункты 7–8)',
  () => {
    let t: TestDatabase;
    let deps: ApiDeps;
    let app: ReturnType<typeof createApp>;
    let builtin = new Map<string, Builtin>();
    const cookies: Record<string, string> = {};
    const call = (login: string, method: 'GET' | 'POST', path: string, body?: unknown) =>
      apiRequest(app, method, path, cookies[login], body);
    const catalog = async (login: string, base: '/api/dm' | '/api/admin/dm') => {
      const res = await call(login, 'GET', `${base}/output`);
      expect(res.status, await res.clone().text()).toBe(200);
      return DmCatalog.parse(await res.json()).items.map((x) => x.code);
    };
    const run = (login: string, base: '/api/dm' | '/api/admin/dm', body: object) =>
      call(login, 'POST', `${base}/output/run`, { params: {}, ...body });
    /** Столбцы ответа «Вывода» — столбцы шаблона без «Контрагента», по порядку. */
    const shownColumns = (tpl: Builtin) =>
      tpl.columns.filter((c) => !c.contractor).map((c) => c.code);

    beforeAll(async () => {
      t = await createTestDatabase();
      await seedAll(t.admin.db, { update: false, demo: true, demoPassword: TEST_PASSWORD });
      await seedAll(t.admin.db, { update: true, demo: true, demoPassword: TEST_PASSWORD });
      await t.admin.db.insert(users).values({
        login: 'rel-platform',
        passwordHash: await hashPassword(TEST_PASSWORD),
        isPlatformAdmin: true,
      });
      deps = createTestDeps({ db: t.app.db });
      app = createApp(deps);
      cookies.owner = await signIn(app, 'erkin', TEST_PASSWORD);
      cookies.admin = await signIn(app, 'rel-platform', TEST_PASSWORD);
      builtin = await builtinsOf(t.admin.db);
    }, 240_000);

    afterAll(async () => {
      await t?.drop();
    });

    it('наполнение и повтор с --update: 12 шаблонов организаций и 6 Админки, каждый один раз и опубликован', async () => {
      const all = [...builtin.values()];
      expect(all.filter((x) => x.audience === 'org')).toHaveLength(ORG_BUILTINS);
      expect(all.filter((x) => x.audience === 'admin')).toHaveLength(ADMIN_BUILTINS);
      expect(all.every((x) => x.state === 'published')).toBe(true);
      const [count] = (await t.admin.db.execute(
        sql`select count(*)::int as n from dm_templates where builtin`,
      )) as unknown as { n: number }[];
      expect(count!.n).toBe(ORG_BUILTINS + ADMIN_BUILTINS);
    });

    it('«Проверка шаблонов» системой: шаблоны организаций — на демо, Админки — от администратора; ни один не сломан', async () => {
      expect(await checkAll(deps)).toBe(ORG_BUILTINS + ADMIN_BUILTINS);
      const after = await builtinsOf(t.admin.db);
      for (const [code, tpl] of after) expect(tpl.state, code).toBe('published');
      const checks = await t.admin.db
        .select({
          code: dmTemplates.code,
          audience: dmTemplates.audience,
          checkError: dmTemplateSql.checkError,
          checkedOrgId: dmTemplateSql.checkedOrgId,
        })
        .from(dmTemplateSql)
        .innerJoin(dmTemplates, eq(dmTemplates.id, dmTemplateSql.templateId))
        .where(eq(dmTemplates.builtin, true));
      for (const c of checks) {
        expect(c.checkError, c.code).toBeNull();
        expect(c.checkedOrgId, c.code).toBe(c.audience === 'org' ? DEMO_ORG_ID : null);
      }
    });

    it('«Вывод» владельца демо: все 12 шаблонов организаций в списке, каждый показывает столбцы шаблона', async () => {
      const codes = await catalog('owner', '/api/dm');
      const org = [...builtin.values()].filter((x) => x.audience === 'org');
      expect(codes).toEqual(expect.arrayContaining(org.map((x) => x.code)));
      for (const tpl of org) {
        const res = await run('owner', '/api/dm', { code: tpl.code });
        expect(res.status, `${tpl.code}: ${await res.clone().text()}`).toBe(200);
        const r = DmRunResult.parse(await res.json());
        expect(
          r.columns.map((c) => c.code),
          tpl.code,
        ).toEqual(shownColumns(tpl));
      }
    });

    it('«Вывод» Админки: шаблоны Админки по всем организациям, шаблон организаций — «глазами демо»', async () => {
      const codes = await catalog('admin', '/api/admin/dm');
      expect(codes).toEqual(expect.arrayContaining([...builtin.keys()]));
      for (const tpl of builtin.values()) {
        const res = await run('admin', '/api/admin/dm', {
          code: tpl.code,
          ...(tpl.audience === 'org' ? { orgId: DEMO_ORG_ID } : {}),
        });
        expect(res.status, `${tpl.code}: ${await res.clone().text()}`).toBe(200);
        const r = DmRunResult.parse(await res.json());
        expect(
          r.columns.map((c) => c.code),
          tpl.code,
        ).toEqual(shownColumns(tpl));
      }
    });

    it('функция «Задачи» выключена — шаблона «Задачи» нет в «Выводе» даже у владельца, «Показать» его не выполняет (п. К-28)', async () => {
      const tasks = builtin.get('tasks');
      expect(tasks, 'готовый шаблон «Задачи»').toBeDefined();
      const inDemo = eq(orgSettings.orgId, DEMO_ORG_ID);
      const [s] = await t.admin.db
        .select({ features: orgSettings.features })
        .from(orgSettings)
        .where(inDemo);
      const features = s!.features as Record<string, boolean>;
      expect(features.tasks).toBe(true);
      try {
        await t.admin.db
          .update(orgSettings)
          .set({ features: { ...features, tasks: false } })
          .where(inDemo);
        expect(await catalog('owner', '/api/dm')).not.toContain(tasks!.code);
        const res = await run('owner', '/api/dm', { code: tasks!.code });
        expect(res.status, await res.clone().text()).toBe(404);
      } finally {
        await t.admin.db.update(orgSettings).set({ features }).where(inDemo);
      }
      expect(await catalog('owner', '/api/dm')).toContain(tasks!.code);
    });
  },
);

describe.skipIf(!databaseAvailable())(
  'Этап 3, П4: готовые шаблоны «Витрины данных» на базе «до выпуска» (0164) после миграций и --update без демо',
  () => {
    let db: Awaited<ReturnType<typeof createTestDatabaseAt>>;
    let deps: ApiDeps;
    let builtin = new Map<string, Builtin>();
    const org = { a: randomUUID(), b: randomUUID() };
    const owner = { a: '', b: '' };
    /** Номера контрагентов и сотрудника каждой организации. */
    const ids: Record<'a' | 'b', string[]> = { a: [], b: [] };
    const cpIds: Record<'a' | 'b', string[]> = { a: [], b: [] };
    let adminId = '';
    /** Названия своих строк организации: по ним видно, чьи строки вернул запрос. */
    const MARK = { a: 'Релизная', b: 'Чужая' } as const;
    const exec = <T>(q: ReturnType<typeof sql>) =>
      db.admin.db.execute(q) as unknown as Promise<T[]>;

    /** Организация со схемы 0164: владелец (роль, пользователь, сотрудник) и контрагенты на нём. */
    async function orgAt0164(id: string, key: 'a' | 'b', contractors: number) {
      const mark = MARK[key];
      await exec(sql`
        insert into organizations (id, name, slug, inn, status, is_demo)
        values (${id}::uuid, ${`ОсОО «${mark} фирма»`}, ${`rel-${key}`},
          ${key === 'a' ? '01811201810461' : '01811201810462'}, 'active', false)`);
      const [role] = await exec<{ id: string }>(sql`
        insert into roles (org_id, name, is_owner) values (${id}::uuid, 'Владелец', true)
        returning id`);
      const [user] = await exec<{ id: string }>(sql`
        insert into users (org_id, login, password_hash) values (${id}::uuid, ${`rel-owner-${key}`}, 'x')
        returning id`);
      const [emp] = await exec<{ id: string }>(sql`
        insert into employees (org_id, user_id, full_name, short_name, role_id)
        values (${id}::uuid, ${user!.id}::uuid, ${`${mark}ов Владелец`}, ${`${mark}ов В.`},
          ${role!.id}::uuid)
        returning id`);
      ids[key].push(emp!.id);
      for (let i = 0; i < contractors; i++) {
        const [cp] = await exec<{ id: string }>(sql`
          insert into contractors (org_id, name, inn, phone, form_code, start_date, service_status,
            responsible_employee_id)
          values (${id}::uuid, ${`ОсОО «${mark} ${i + 1}»`},
            ${`02${key === 'a' ? '3' : '4'}${String(i).padStart(11, '0')}`}, '+996505890076',
            'ФС-01', '2025-01-01', 'active', ${emp!.id}::uuid)
          returning id`);
        ids[key].push(cp!.id);
        cpIds[key].push(cp!.id);
      }
      return user!.id;
    }

    const runOrg = async (tpl: Builtin, orgId: string, userId: string) => {
      const bound = dmBind(tpl.query, dmParamDefsOf(tpl.params), {}, bishkekDate(new Date()));
      if (!bound.ok) throw new Error(`${tpl.code}: ${JSON.stringify(bound)}`);
      return runDmOrg(
        db.app.db,
        { orgId, userId },
        { text: bound.text, params: bound.params, maxRows: 50_000 },
      );
    };

    beforeAll(async () => {
      db = await createTestDatabaseAt('0164_file_copies_merge_late_release');
      await exec(sql`
        insert into ownership_forms (code, name, sort_order) values ('ФС-01', 'ОсОО', 1)
        on conflict (code) do nothing`);
      owner.a = await orgAt0164(org.a, 'a', 3);
      owner.b = await orgAt0164(org.b, 'b', 1);
      const [admin] = await exec<{ id: string }>(sql`
        insert into users (login, password_hash, is_platform_admin) values ('rel-admin', 'x', true)
        returning id`);
      adminId = admin!.id;
      await db.migrateRest();
      // Как «Выпустить на рабочий сайт»: `pnpm db:seed --update` с APP_ENV=production — без демо.
      await seedAll(db.admin.db, { update: true, demo: false });
      deps = createTestDeps({ db: db.app.db });
      builtin = await builtinsOf(db.admin.db);
    }, 240_000);

    afterAll(async () => {
      await db?.drop();
    });

    it('после миграций и --update: 12 шаблонов организаций и 6 Админки, опубликованы; демо-организации нет', async () => {
      const all = [...builtin.values()];
      expect(all.filter((x) => x.audience === 'org')).toHaveLength(ORG_BUILTINS);
      expect(all.filter((x) => x.audience === 'admin')).toHaveLength(ADMIN_BUILTINS);
      expect(all.every((x) => x.state === 'published')).toBe(true);
      const orgs = await db.admin.db
        .select({ id: organizations.id, demo: organizations.isDemo })
        .from(organizations);
      expect(orgs.map((o) => o.id).sort()).toEqual([org.a, org.b].sort());
      expect(orgs.every((o) => !o.demo)).toBe(true);
    });

    it('«Проверка шаблонов» без демо: шаблоны организаций — в пустом контексте, ни один не сломан', async () => {
      expect(await checkAll(deps)).toBe(ORG_BUILTINS + ADMIN_BUILTINS);
      const checks = await db.admin.db
        .select({
          code: dmTemplates.code,
          state: dmTemplates.state,
          checkError: dmTemplateSql.checkError,
          checkedOrgId: dmTemplateSql.checkedOrgId,
        })
        .from(dmTemplateSql)
        .innerJoin(dmTemplates, eq(dmTemplates.id, dmTemplateSql.templateId))
        .where(eq(dmTemplates.builtin, true));
      for (const c of checks) {
        expect(c, c.code).toMatchObject({
          state: 'published',
          checkError: null,
          checkedOrgId: null,
        });
      }
    });

    it('каждый шаблон организаций выполняется в каждой организации и не видит чужих строк; «Контрагенты» — свои', async () => {
      for (const tpl of builtin.values()) {
        if (tpl.audience !== 'org') continue;
        for (const [key, other] of [
          ['a', 'b'],
          ['b', 'a'],
        ] as const) {
          const r = await runOrg(tpl, org[key], owner[key]);
          expect(r.columns, `${tpl.code} ${key}`).toEqual(tpl.columns.map((c) => c.code));
          const text = JSON.stringify(r.rows);
          expect(text, `${tpl.code}: строки организации ${other} в контексте ${key}`).not.toContain(
            MARK[other],
          );
          for (const id of [org[other], ...ids[other]]) expect(text, tpl.code).not.toContain(id);
        }
      }
      // «Контрагенты» организации А — ровно её три контрагента.
      const own = await runOrg(builtin.get('contractors')!, org.a, owner.a);
      const at = own.columns.indexOf('contractor_id');
      expect(own.rows.map((r) => r[at]).sort()).toEqual([...cpIds.a].sort());
    });

    it('шаблоны Админки выполняются по всем организациям базы выпуска', async () => {
      for (const tpl of builtin.values()) {
        if (tpl.audience !== 'admin') continue;
        const bound = dmBind(tpl.query, dmParamDefsOf(tpl.params), {}, bishkekDate(new Date()));
        if (!bound.ok) throw new Error(`${tpl.code}: ${JSON.stringify(bound)}`);
        const r = await runDmAdmin(db.app.db, adminId, {
          text: bound.text,
          params: bound.params,
          maxRows: 50_000,
        });
        expect(r.columns, tpl.code).toEqual(tpl.columns.map((c) => c.code));
      }
    });
  },
);
