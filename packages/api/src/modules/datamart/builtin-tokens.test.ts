import { schema } from '@buhuchet/db';
import { seedAll } from '@buhuchet/db/seed';
import { databaseAvailable } from '@buhuchet/db/testing';
import { SCOPE_GROUPS, UI_TEXTS, type ScopeGroupId } from '@buhuchet/domain';
import { ApiError, DmTokenCard, DmTokenForm, DmTokenIssued } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

/*
 * Этап 3, П4 общего плана 20.11 (задача-проверка потока К; п. К-28): токены к готовым шаблонам
 * «Выручка по контрагентам» и «Задачи» настоящим путём окна «Новый API-токен», выпуска, перевыпуска и
 * внешнего адреса — доработки 20.11.2026: Витрина данных, блок 2, пункт 6; блок 5, пункт 7; блок 8,
 * пункт 8. Токен отдаёт строки всей организации (п. Т-26): к «Выручке» — только когда отбора «Свои» нет
 * ни в «Контрагентах», ни в «Проектах контрагентов»; токен к «Задачам» при выключенной функции «Задачи»
 * не отвечает, а после включения работает без перевыпуска.
 * Сегодня в тестах — 18.10.2026.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const { dmRequests, dmTemplates, dmTokens, employees, orgSettings, rolePermissions, roleScopes } =
  schema;

describe.skipIf(!databaseAvailable())(
  'Этап 3, П4: токены к готовым «Выручке по контрагентам» и «Задачам» (п. К-28)',
  () => {
    let f: Fixture;
    let owner = '';
    let acc = '';
    let roleId = '';
    let ipN = 0;
    const ids = new Map<string, string>();

    const call = (cookie: string, method: 'GET' | 'POST', path: string, body?: unknown) =>
      apiRequest(f.app, method, path, cookie, body);
    const failure = async (res: Response) => ApiError.parse(await res.json()).error;
    /** Шаблоны окна «Новый API-токен». */
    const formCodes = async (cookie: string) => {
      const res = await call(cookie, 'GET', '/api/dm/tokens/form');
      expect(res.status, await res.clone().text()).toBe(200);
      const form = DmTokenForm.parse(await res.json());
      expect(form.refusal).toBeNull();
      return form.templates.map((t) => t.code);
    };
    const issue = (cookie: string, code: string) =>
      call(cookie, 'POST', '/api/dm/tokens', {
        templateId: ids.get(code),
        name: `Токен ${code} ${++ipN}`,
        term: 30,
      });
    /** Область группы у роли бухгалтера с токенами. */
    const scope = (group: ScopeGroupId, value: 'own' | 'all') =>
      f.t.admin.db
        .update(roleScopes)
        .set({ scope: value })
        .where(and(eq(roleScopes.roleId, roleId), eq(roleScopes.permGroup, group)));
    const features = async (patch: Record<string, boolean>) => {
      const [row] = await f.t.admin.db
        .select({ features: orgSettings.features })
        .from(orgSettings)
        .where(eq(orgSettings.orgId, f.a.orgId));
      await f.t.admin.db
        .update(orgSettings)
        .set({ features: { ...row!.features, ...patch } })
        .where(eq(orgSettings.orgId, f.a.orgId));
    };
    /** Свой адрес у каждого запроса: предел неверных токенов по адресу здесь ни при чём. */
    const ext = (code: string, token: string) =>
      f.app.request(`/api/ext/v1/${code}`, {
        headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': `198.51.100.${++ipN}` },
      });

    beforeAll(async () => {
      f = await createStaffFixture();
      const db = f.t.admin.db;
      // Справочники платформы и готовые шаблоны — как наполнение рабочей базы (без демо).
      await seedAll(db, { update: false, demo: false });
      for (const row of await db
        .select({ id: dmTemplates.id, code: dmTemplates.code })
        .from(dmTemplates)
        .where(eq(dmTemplates.builtin, true)))
        ids.set(row.code, row.id);
      await db.update(orgSettings).set({ extApi: true }).where(eq(orgSettings.orgId, f.a.orgId));
      await features({ fee: true, tasks: true, projects: true });
      // Бухгалтер с токенами: права «Бухгалтера» + плата за обслуживание, «Смотреть витрину данных» и
      // «API Токены»; «Контрагенты» — «Все», остальные группы — «Свои».
      const accPerms = (
        await db
          .select({ id: rolePermissions.permissionId })
          .from(rolePermissions)
          .where(eq(rolePermissions.roleId, f.templateRole(f.a, 'acc')))
      ).map((r) => r.id);
      const [role] = await db
        .insert(schema.roles)
        .values({ orgId: f.a.orgId, name: 'Бухгалтер с токенами' })
        .returning({ id: schema.roles.id });
      roleId = role!.id;
      await db.insert(rolePermissions).values(
        [...new Set([...accPerms, 'fee', 'dmView', 'dmTokens'])].map((permissionId) => ({
          orgId: f.a.orgId,
          roleId,
          permissionId,
        })),
      );
      await db.insert(roleScopes).values(
        SCOPE_GROUPS.map((g) => ({
          orgId: f.a.orgId,
          roleId,
          permGroup: g,
          scope: g === 'cps' ? ('all' as const) : ('own' as const),
        })),
      );
      await db
        .update(employees)
        .set({ roleId })
        .where(eq(employees.id, f.people['acc-a']!.employeeId));
      [owner, acc] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'acc-a', TEST_PASSWORD),
      ]);
    }, 120_000);

    afterAll(async () => {
      await f?.t.drop();
    });

    it('«Выручка по контрагентам»: при «Свои» в «Проектах» её нет в окне «Новый API-токен», выпуск — 400; при «Все» в обеих группах — выпускается; область сузилась — перевыпуск 409', async () => {
      try {
        // «Контрагенты» — «Все», «Проекты» — «Свои»: «Плата за обслуживание» (только «Контрагенты»)
        // в окне есть, «Выручки» (в ней суммы проектов и услуг) — нет.
        let codes = await formCodes(acc);
        expect(codes).toContain('service-fee');
        expect(codes).not.toContain('revenue');
        let res = await issue(acc, 'revenue');
        expect(res.status, await res.clone().text()).toBe(400);
        expect(await failure(res)).toMatchObject({
          code: 'dm_token_template',
          message: UI_TEXTS['err.dm_token_template'].ru,
        });

        // «Все» и в «Проектах»: отбора нет ни по одной группе — токен выпускается.
        await scope('projects', 'all');
        codes = await formCodes(acc);
        expect(codes).toContain('revenue');
        res = await issue(acc, 'revenue');
        expect(res.status, await res.clone().text()).toBe(201);
        const made = DmTokenIssued.parse(await res.json());

        // Область «Проектов» снова «Свои»: перевыпуск к «Выручке» не даётся, прежний токен не тронут.
        await scope('projects', 'own');
        res = await call(acc, 'POST', `/api/dm/tokens/${made.item.id}/reissue`);
        expect(res.status, await res.clone().text()).toBe(409);
        expect((await failure(res)).code).toBe('dm_token_template');
        const left = await f.t.admin.db
          .select({ id: dmTokens.id, revokedAt: dmTokens.revokedAt })
          .from(dmTokens)
          .where(eq(dmTokens.templateId, ids.get('revenue')!));
        expect(left).toEqual([{ id: made.item.id, revokedAt: null }]);
      } finally {
        await scope('projects', 'own');
      }
    });

    it('«Задачи»: функция «Задачи» выключена — шаблона нет в окне, токен не отвечает («Доступ остановлен», в журнале — «Доступ закрыт»); включена — тот же токен отвечает без перевыпуска', async () => {
      expect(await formCodes(owner)).toContain('tasks');
      const res = await issue(owner, 'tasks');
      expect(res.status, await res.clone().text()).toBe(201);
      const { token, item } = DmTokenIssued.parse(await res.json());
      const row = async () =>
        (
          await f.t.admin.db
            .select({ hash: dmTokens.tokenHash, revokedAt: dmTokens.revokedAt })
            .from(dmTokens)
            .where(eq(dmTokens.id, item.id))
        )[0]!;
      const issued = await row();
      try {
        expect((await ext('tasks', token)).status).toBe(200);

        await features({ tasks: false });
        expect(await formCodes(owner)).not.toContain('tasks');
        const off = await ext('tasks', token);
        expect(off.status, await off.clone().text()).toBe(403);
        expect(await failure(off)).toMatchObject({
          code: 'dm_ext_stopped',
          message: UI_TEXTS['err.dm_ext_stopped'].ru,
        });
        // Токен не отозван и не перевыпущен (п. Т-28: в списке — без причины).
        expect(await row()).toEqual(issued);
        const card = await call(owner, 'GET', `/api/dm/tokens/${item.id}`);
        expect(card.status, await card.clone().text()).toBe(200);
        expect(DmTokenCard.parse(await card.json()).state).not.toBe('revoked');

        await features({ tasks: true });
        expect((await ext('tasks', token)).status).toBe(200);
        expect(await row()).toEqual(issued);
        const log = await f.t.admin.db
          .select({ outcome: dmRequests.outcome })
          .from(dmRequests)
          .where(eq(dmRequests.tokenId, item.id))
          .orderBy(dmRequests.id);
        expect(log.map((r) => r.outcome)).toEqual(['ok', 'closed', 'ok']);
      } finally {
        await features({ tasks: true });
      }
    });
  },
);
