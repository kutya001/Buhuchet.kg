import { dmParamDefsOf, runDmOrg, schema, type DmTemplateColumn } from '@buhuchet/db';
import { DEMO_ORG_ID, demoId, seedAll } from '@buhuchet/db/seed';
import { createTestDatabase, databaseAvailable, type TestDatabase } from '@buhuchet/db/testing';
import { bishkekDate, dmBind, SCOPE_GROUPS, type DmParamDef } from '@buhuchet/domain';
import { DmCatalog, DmRunResult } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import { apiRequest, createTestDeps, signIn, TEST_PASSWORD } from '../../testing';

/*
 * Готовые шаблоны «Витрины данных» на демо-организации: столбец «Контрагент», область «Свои» и права
 * (доработки 20.11.2026: Витрина данных, блок 2, пункт 6; блок 7; «Как проверить…» → «Права и вывод»;
 * общий план 20.11, этап 2, П9). Запрос идёт настоящим путём «Вывода» (`POST /api/dm/output/run`):
 * сеанс, право, видимость шаблона, отбор «Свои», исполнитель. Ожидаемое считается из того же запроса
 * шаблона без отбора (с отметкой «Контрагент»): строки только контрагентов, за которых сотрудник отвечает.
 */

const { contractors, dmTemplateSql, dmTemplates, employees, rolePermissions, roleScopes, roles } =
  schema;

/** Бухгалтер демо (роль «Бухгалтер», область «Свои» во всех группах): Алишер Т. */
const ACC = 'alisher';
/**
 * Бухгалтер с правом «Видеть плату за обслуживание», но без «Просматривать финансовые операции»; ещё
 * «Просматривать сотрудников» и «Видеть задачи всех» — ему виден шаблон «Задачи» (модуль без области).
 */
const FEE_ACC = 'aigerim';
/**
 * Бухгалтер с «Просматривать сотрудников», без «Видеть задачи всех»; области разные: «Контрагенты» —
 * «Все», остальные группы — «Свои».
 */
const STAFF_ACC = 'nurlan';
const OWNER = 'erkin';

interface Builtin {
  id: string;
  code: string;
  params: {
    code: string;
    name: string;
    type: DmParamDef['type'];
    required: boolean;
    default: string | null;
  }[];
  columns: DmTemplateColumn[];
  query: string;
}

/** Строки для сравнения без порядка: отбор «Свои» оборачивает запрос, порядок строк — не его дело. */
const sorted = (rows: unknown[][]) => rows.map((r) => JSON.stringify(r)).sort();

describe.skipIf(!databaseAvailable())(
  'готовые шаблоны «Витрины данных»: область «Свои» и права на демо',
  () => {
    let t: TestDatabase;
    let deps: ApiDeps;
    let app: ReturnType<typeof createApp>;
    const cookies: Record<string, string> = {};
    const builtin = new Map<string, Builtin>();
    /** Контрагенты, за которых отвечает бухгалтер `ACC`. */
    let mine = new Set<string>();

    const call = (login: string, method: 'GET' | 'POST', path: string, body?: unknown) =>
      apiRequest(app, method, path, cookies[login], body);
    const catalog = async (login: string) => {
      const res = await call(login, 'GET', '/api/dm/output');
      expect(res.status, await res.clone().text()).toBe(200);
      return DmCatalog.parse(await res.json())
        .items.map((x) => x.code)
        .sort();
    };
    const run = (login: string, code: string) =>
      call(login, 'POST', '/api/dm/output/run', { code, params: {} });
    const shown = async (login: string, code: string) => {
      const res = await run(login, code);
      expect(res.status, `${login} ${code}: ${await res.clone().text()}`).toBe(200);
      return DmRunResult.parse(await res.json());
    };
    /**
     * Запрос шаблона без отбора — с «Контрагентом»: столбцы ответа (без «Контрагента») и номер
     * контрагента каждой строки. «Сегодня» — по часам приложения, как у «Вывода».
     */
    const raw = async (code: string) => {
      const tpl = builtin.get(code)!;
      const bound = dmBind(tpl.query, dmParamDefsOf(tpl.params), {}, bishkekDate(deps.clock.now()));
      if (!bound.ok) throw new Error(`${code}: ${JSON.stringify(bound)}`);
      const r = await runDmOrg(
        t.app.db,
        { orgId: DEMO_ORG_ID, userId: demoId('user', 'e1') },
        { text: bound.text, params: bound.params, maxRows: 50_000 },
      );
      const cp = tpl.columns.find((c) => c.contractor)!.code;
      const at = tpl.columns.filter((c) => !c.contractor).map((c) => r.columns.indexOf(c.code));
      const cpAt = r.columns.indexOf(cp);
      expect(cpAt, `${code}: столбец «Контрагент» в ответе запроса`).toBeGreaterThanOrEqual(0);
      // Значения — как их отдаёт метод: через JSON.
      return r.rows.map((row) => ({
        contractor: row[cpAt] as string | null,
        shown: JSON.parse(JSON.stringify(at.map((i) => row[i]))) as unknown[],
      }));
    };

    beforeAll(async () => {
      t = await createTestDatabase();
      await seedAll(t.admin.db, { update: false, demo: true, demoPassword: TEST_PASSWORD });
      const db = t.admin.db;
      // Бухгалтеру демо — «Смотреть витрину данных» (в демо его нет ни у одной роли, кроме владельца).
      const acc = demoId('role', 'acc');
      await db
        .insert(rolePermissions)
        .values({ orgId: DEMO_ORG_ID, roleId: acc, permissionId: 'dmView' });
      // Свой бухгалтер с платой за обслуживание, без финансовых операций: права «Бухгалтера» − finView
      // + fee, staffView и tasksAll (шаблон «Задачи»), область «Свои» во всех группах.
      const accPerms = (
        await db
          .select({ id: rolePermissions.permissionId })
          .from(rolePermissions)
          .where(eq(rolePermissions.roleId, acc))
      ).map((r) => r.id);
      const [feeRole] = await db
        .insert(roles)
        .values({ orgId: DEMO_ORG_ID, name: 'Бухгалтер с платой' })
        .returning({ id: roles.id });
      await db.insert(rolePermissions).values(
        [...accPerms.filter((p) => p !== 'finView'), 'fee', 'staffView', 'tasksAll'].map(
          (permissionId) => ({
            orgId: DEMO_ORG_ID,
            roleId: feeRole!.id,
            permissionId,
          }),
        ),
      );
      await db.insert(roleScopes).values(
        SCOPE_GROUPS.map((g) => ({
          orgId: DEMO_ORG_ID,
          roleId: feeRole!.id,
          permGroup: g,
          scope: 'own' as const,
        })),
      );
      await db
        .update(employees)
        .set({ roleId: feeRole!.id })
        .where(eq(employees.id, demoId('employee', 'e4')));
      const [staffRole] = await db
        .insert(roles)
        .values({ orgId: DEMO_ORG_ID, name: 'Бухгалтер с сотрудниками' })
        .returning({ id: roles.id });
      await db.insert(rolePermissions).values(
        [...accPerms, 'staffView'].map((permissionId) => ({
          orgId: DEMO_ORG_ID,
          roleId: staffRole!.id,
          permissionId,
        })),
      );
      await db.insert(roleScopes).values(
        SCOPE_GROUPS.map((g) => ({
          orgId: DEMO_ORG_ID,
          roleId: staffRole!.id,
          permGroup: g,
          scope: g === 'cps' ? ('all' as const) : ('own' as const),
        })),
      );
      await db
        .update(employees)
        .set({ roleId: staffRole!.id })
        .where(eq(employees.id, demoId('employee', 'e5')));

      deps = createTestDeps({ db: t.app.db });
      app = createApp(deps);
      for (const login of [OWNER, ACC, FEE_ACC, STAFF_ACC]) {
        cookies[login] = await signIn(app, login, TEST_PASSWORD);
      }
      for (const row of await db
        .select({
          id: dmTemplates.id,
          code: dmTemplates.code,
          params: dmTemplates.params,
          columns: dmTemplates.columns,
          query: dmTemplateSql.query,
        })
        .from(dmTemplates)
        .innerJoin(dmTemplateSql, eq(dmTemplateSql.templateId, dmTemplates.id))
        .where(and(eq(dmTemplates.builtin, true), eq(dmTemplates.audience, 'org'))))
        builtin.set(row.code, row as Builtin);
      mine = new Set(
        (
          await db
            .select({ id: contractors.id })
            .from(contractors)
            .where(
              and(
                eq(contractors.orgId, DEMO_ORG_ID),
                eq(contractors.responsibleEmployeeId, demoId('employee', 'e3')),
              ),
            )
        ).map((r) => r.id),
      );
    });

    afterAll(async () => {
      await t?.drop();
    });

    it('столбец «Контрагент»: он есть у каждого готового шаблона организаций с контрагентами (11 из 12) и приходит в ответе запроса; у «Сдачи отчётов по сотрудникам» — нет', async () => {
      const withCp = [...builtin.values()].filter((x) => x.columns.some((c) => c.contractor));
      expect(withCp.map((x) => x.code).sort()).toEqual([
        'contractors',
        'debtors',
        'indicators-by-month',
        'money-operations',
        'projects-services',
        'reports-due',
        'reports-overdue',
        'revenue',
        'service-fee',
        'tasks',
        'tax-due',
      ]);
      expect(builtin.get('reports-by-staff')!.columns.some((c) => c.contractor)).toBe(false);
      for (const x of withCp) {
        // Один столбец «Контрагент», вида `cp` — его не показывает ни «Вывод», ни внешний ответ.
        expect(
          x.columns.filter((c) => c.contractor).map((c) => [c.code, c.type]),
          x.code,
        ).toEqual([['contractor_id', 'cp']]);
        // Номер контрагента в ответе — контрагент демо-организации (или пусто у записи без контрагента).
        const ids = new Set(
          (
            await t.admin.db
              .select({ id: contractors.id })
              .from(contractors)
              .where(eq(contractors.orgId, DEMO_ORG_ID))
          ).map((r) => r.id),
        );
        for (const row of await raw(x.code)) {
          if (row.contractor !== null) expect(ids.has(row.contractor), x.code).toBe(true);
        }
      }
    });

    it('каталог: бухгалтеру со «Свои» — без шаблона без «Контрагента» и без шаблонов платы за обслуживание (нет права); с правом на плату, но без «Просматривать финансовые операции» — без «Финансовых операций»; скрытый шаблон — 404', async () => {
      const all = [...builtin.keys()].sort();
      expect(await catalog(OWNER)).toEqual(all);
      const acc = await catalog(ACC);
      expect(acc).toEqual([
        'contractors',
        'indicators-by-month',
        'money-operations',
        'projects-services',
        'reports-due',
        'reports-overdue',
        'tax-due',
      ]);
      const fee = await catalog(FEE_ACC);
      expect(fee).toEqual([
        'contractors',
        'debtors',
        'indicators-by-month',
        'projects-services',
        'reports-due',
        'reports-overdue',
        'revenue',
        'service-fee',
        'tasks',
        'tax-due',
      ]);
      for (const [login, code] of [
        [ACC, 'reports-by-staff'],
        [ACC, 'debtors'],
        [FEE_ACC, 'money-operations'],
        [FEE_ACC, 'reports-by-staff'],
      ] as const) {
        const res = await run(login, code);
        expect(res.status, `${login} ${code}`).toBe(404);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
          'dm_template_not_found',
        );
      }
    });

    it('«Отчёты к сдаче» бухгалтеру со «Свои» — только отчёты его контрагентов; владельцу — все', async () => {
      const rows = await raw('reports-due');
      const own = rows.filter((r) => r.contractor !== null && mine.has(r.contractor));
      // На демо в периоде по умолчанию есть отчёты и его контрагентов, и чужих — отбору есть что убрать.
      expect(own.length).toBeGreaterThan(0);
      expect(own.length).toBeLessThan(rows.length);
      const acc = await shown(ACC, 'reports-due');
      expect(acc.columns.map((c) => c.code)).not.toContain('contractor_id');
      expect(sorted(acc.rows)).toEqual(sorted(own.map((r) => r.shown)));
      const owner = await shown(OWNER, 'reports-due');
      expect(sorted(owner.rows)).toEqual(sorted(rows.map((r) => r.shown)));
    });

    it('каждый готовый шаблон, видный бухгалтеру со «Свои»: строки только его контрагентов; владельцу — все строки организации', async () => {
      for (const [login, codes] of [
        [ACC, await catalog(ACC)],
        [FEE_ACC, await catalog(FEE_ACC)],
      ] as const) {
        const own =
          login === ACC
            ? mine
            : new Set(
                (
                  await t.admin.db
                    .select({ id: contractors.id })
                    .from(contractors)
                    .where(eq(contractors.responsibleEmployeeId, demoId('employee', 'e4')))
                ).map((r) => r.id),
              );
        for (const code of codes) {
          const rows = await raw(code);
          const ownRows = rows.filter((r) => r.contractor !== null && own.has(r.contractor));
          // На демо со значениями по умолчанию у каждого шаблона есть строки и его контрагентов, и чужих.
          expect(ownRows.length, `${login} ${code}`).toBeGreaterThan(0);
          expect(ownRows.length, `${login} ${code}`).toBeLessThan(rows.length);
          const got = await shown(login, code);
          expect(sorted(got.rows), `${login} ${code}`).toEqual(sorted(ownRows.map((r) => r.shown)));
        }
      }
      for (const code of builtin.keys()) {
        if (!builtin.get(code)!.columns.some((c) => c.contractor)) continue;
        const got = await shown(OWNER, code);
        expect(sorted(got.rows), code).toEqual(sorted((await raw(code)).map((r) => r.shown)));
      }
    });

    it('«Задачи» — только с «Видеть задачи всех» (п. К-27): с «Просматривать сотрудников» без него шаблона нет, «Показать» — 404; отбор берёт область группы модуля шаблона', async () => {
      expect(await catalog(OWNER)).toContain('tasks');
      expect(await catalog(STAFF_ACC)).toEqual([
        'contractors',
        'indicators-by-month',
        'money-operations',
        'projects-services',
        'reports-due',
        'reports-overdue',
        'tax-due',
      ]);
      const res = await run(STAFF_ACC, 'tasks');
      expect(res.status, await res.clone().text()).toBe(404);
      // «Контрагенты» — «Все»: шаблон «Контрагенты» целиком; «Отчёты» и «Финансовые операции» — «Свои».
      const own = new Set(
        (
          await t.admin.db
            .select({ id: contractors.id })
            .from(contractors)
            .where(eq(contractors.responsibleEmployeeId, demoId('employee', 'e5')))
        ).map((r) => r.id),
      );
      expect(own.size).toBeGreaterThan(0);
      const all = await raw('contractors');
      expect(sorted((await shown(STAFF_ACC, 'contractors')).rows)).toEqual(
        sorted(all.map((r) => r.shown)),
      );
      for (const code of ['reports-due', 'money-operations']) {
        const rows = await raw(code);
        const ownRows = rows.filter((r) => r.contractor !== null && own.has(r.contractor));
        expect(ownRows.length, code).toBeGreaterThan(0);
        expect(ownRows.length, code).toBeLessThan(rows.length);
        expect(sorted((await shown(STAFF_ACC, code)).rows), code).toEqual(
          sorted(ownRows.map((r) => r.shown)),
        );
      }
    });
  },
);
