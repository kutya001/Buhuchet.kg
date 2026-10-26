import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import { PERMISSIONS, PERMISSION_IDS, SCOPE_GROUPS } from '@buhuchet/domain';
import { ApiError, MeResponse, PermissionCatalog, Role, RoleList } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

const { auditLog } = schema;

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

async function apiErr(res: Response) {
  return ApiError.parse(await res.json()).error;
}

describe.skipIf(!databaseAvailable())('Роли: API', () => {
  let f: Fixture;
  let owner: string;
  let hr: string;
  let acc: string;
  let ownerB: string;

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    cookie?: string,
    body?: unknown,
  ) => apiRequest(f.app, method, path, cookie, body);

  async function role(id: string, cookie = owner): Promise<Role> {
    const res = await call('GET', `/api/roles/${id}`, cookie);
    expect(res.status).toBe(200);
    return Role.parse(await res.json());
  }

  async function me(cookie: string): Promise<MeResponse> {
    return MeResponse.parse(await (await call('GET', '/api/auth/me', cookie)).json());
  }

  async function newRole(name: string, copyFromRoleId?: string, cookie = owner): Promise<Role> {
    const res = await call('POST', '/api/roles', cookie, { name, copyFromRoleId });
    expect(res.status, await res.clone().text()).toBe(201);
    return Role.parse(await res.json());
  }

  beforeAll(async () => {
    f = await createStaffFixture();
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    hr = await signIn(f.app, 'hr-a', TEST_PASSWORD);
    acc = await signIn(f.app, 'acc-a', TEST_PASSWORD);
    ownerB = await signIn(f.app, 'owner-b', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  describe('список, карточка, справочник прав', () => {
    it('список ролей: число активных сотрудников и прав, у владельца — все 39', async () => {
      const res = await call('GET', '/api/roles', owner);
      expect(res.status).toBe(200);
      const { items } = RoleList.parse(await res.json());
      const byName = Object.fromEntries(items.map((r) => [r.name, r]));
      expect(Object.keys(byName)).toEqual(
        expect.arrayContaining(['Владелец организации', 'Главный бухгалтер', 'Бухгалтер', 'Кадры']),
      );
      expect(byName['Владелец организации']).toMatchObject({
        isOwner: true,
        employees: 1,
        permissionCount: 39,
      });
      expect(byName['Кадры']).toMatchObject({ isOwner: false, employees: 1, permissionCount: 2 });
      expect(byName['Бухгалтер']!.employees).toBe(1);
      // Роли другой организации не видны.
      expect(items).toHaveLength(5);
    });

    it('без права «Сотрудники и роли» роли и справочник прав не отдаются', async () => {
      const chief = await signIn(f.app, 'chief-a', TEST_PASSWORD);
      for (const path of ['/api/roles', `/api/roles/${f.roleIds.hr}`, '/api/permissions']) {
        expect((await call('GET', path, chief)).status).toBe(403);
      }
      expect((await call('GET', '/api/roles')).status).toBe(401);
    });

    it('карточка: у роли владельца все права и «Все» везде; у шаблона — его права и область', async () => {
      const ownerRole = await role(f.a.roles.find((r) => r.isOwner)!.id);
      expect(ownerRole.permissions).toEqual([...PERMISSION_IDS]);
      expect(Object.values(ownerRole.scopes)).toEqual(SCOPE_GROUPS.map(() => 'all'));
      const chiefRole = await role(f.templateRole(f.a, 'chief'));
      expect(chiefRole.permissions).toContain('viewAll');
      expect(chiefRole.permissions).not.toContain('staff');
      expect(chiefRole.scopes).toMatchObject({ cps: 'all', reports: 'all' });
      const accRole = await role(f.templateRole(f.a, 'acc'));
      expect(Object.values(accRole.scopes)).toEqual(SCOPE_GROUPS.map(() => 'own'));
    });

    it('справочник прав: 39 прав в порядке формы, группы — как в каталоге системы', async () => {
      const res = await call('GET', '/api/permissions', hr);
      expect(res.status).toBe(200);
      const { items } = PermissionCatalog.parse(await res.json());
      expect(items.map((p) => [p.id, p.group])).toEqual(PERMISSIONS.map(([id, g]) => [id, g]));
      expect(items.find((p) => p.id === 'staff')!.name).toBe('Сотрудники и роли');
      expect(items.every((p) => p.description.length > 0)).toBe(true);
    });

    it('чужая организация: карточка, правка, удаление — 404', async () => {
      const id = f.roleIds.hr;
      expect((await call('GET', `/api/roles/${id}`, ownerB)).status).toBe(404);
      expect(
        (await call('PATCH', `/api/roles/${id}`, ownerB, { version: 1, name: 'X' })).status,
      ).toBe(404);
      expect((await call('DELETE', `/api/roles/${id}?version=1`, ownerB)).status).toBe(404);
      expect((await role(id)).name).toBe('Кадры');
    });
  });

  describe('новая роль', () => {
    it('копия прав из роли-образца, область «Свои» везде, запись в истории', async () => {
      const chiefRole = await role(f.templateRole(f.a, 'chief'));
      const created = await newRole('Старший бухгалтер', chiefRole.id);
      expect(created).toMatchObject({
        name: 'Старший бухгалтер',
        isOwner: false,
        employees: 0,
        permissions: chiefRole.permissions,
        permissionCount: chiefRole.permissions.length,
        audit: { createdBy: 'owner-a В.' },
        version: 1,
      });
      expect(Object.values(created.scopes)).toEqual(SCOPE_GROUPS.map(() => 'own'));
      const [entry] = await f.t.admin.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'role'), eq(auditLog.entityId, created.id)));
      expect(entry).toMatchObject({ action: 'create', actorUserId: f.a.ownerUserId });

      const empty = await newRole('Пустая');
      expect(empty.permissions).toEqual([]);
    });

    it('не владелец не копирует права, которые выдаёт только владелец', async () => {
      const fromOwner = await newRole('Почти всё', f.a.roles.find((r) => r.isOwner)!.id, hr);
      expect(fromOwner.permissions).not.toEqual(expect.arrayContaining(['staff']));
      for (const p of ['staff', 'rollback', 'archiveRest', 'org'] as const) {
        expect(fromOwner.permissions).not.toContain(p);
      }
      expect(fromOwner.permissions).toHaveLength(35);
      const byOwner = await newRole('Всё кроме настроек', f.a.roles.find((r) => r.isOwner)!.id);
      expect(byOwner.permissions).toHaveLength(38);
    });

    it('название уникально в организации; образец из чужой организации — 400', async () => {
      const dup = await call('POST', '/api/roles', owner, { name: 'Бухгалтер' });
      expect(dup.status).toBe(400);
      expect(await apiErr(dup)).toEqual({
        code: 'role_name_taken',
        message: 'Такая роль уже есть',
      });
      // В другой организации то же название можно.
      expect((await call('POST', '/api/roles', ownerB, { name: 'Кадры' })).status).toBe(201);
      const foreign = await call('POST', '/api/roles', owner, {
        name: 'Чужая копия',
        copyFromRoleId: f.templateRole(f.b, 'chief'),
      });
      expect(foreign.status).toBe(400);
      expect((await apiErr(foreign)).code).toBe('role_not_found');
      expect((await call('POST', '/api/roles', owner, { name: '  ' })).status).toBe(400);
    });
  });

  describe('права и область роли', () => {
    it('право просмотра проектов появляется в правах для меню сразу после сохранения роли', async () => {
      const accRole = await role(f.templateRole(f.a, 'acc'));
      expect((await me(acc)).permissions).toContain('projView');
      const without = accRole.permissions.filter((p) => p !== 'projView');
      const res = await call('PATCH', `/api/roles/${accRole.id}`, owner, {
        version: accRole.version,
        permissions: without,
      });
      expect(res.status).toBe(200);
      const saved = Role.parse(await res.json());
      expect(saved.permissions).not.toContain('projView');
      expect(saved.version).toBe(accRole.version + 1);
      // Роль без «Просматривать проекты» не видит модуль «Проекты»: права для меню без projView.
      expect((await me(acc)).permissions).not.toContain('projView');

      const back = await call('PATCH', `/api/roles/${accRole.id}`, owner, {
        version: saved.version,
        permissions: [...without, 'projView'],
      });
      expect(back.status).toBe(200);
      expect((await me(acc)).permissions).toContain('projView');

      const history = await f.t.admin.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entity, 'role'),
            eq(auditLog.entityId, accRole.id),
            eq(auditLog.action, 'update'),
          ),
        );
      expect(history[0]!.changes).toEqual([
        { field: 'permissions', from: accRole.permissions, to: without },
      ]);
      expect(history[0]!.actorUserId).toBe(f.a.ownerUserId);
    });

    it('область группы и «Видеть все отчёты и всех контрагентов»', async () => {
      const accRole = await role(f.templateRole(f.a, 'acc'));
      const res = await call('PATCH', `/api/roles/${accRole.id}`, owner, {
        version: accRole.version,
        scopes: { fin: 'all', cps: 'own' },
      });
      expect(res.status).toBe(200);
      const saved = Role.parse(await res.json());
      expect(saved.scopes).toMatchObject({ fin: 'all', cps: 'own' });
      expect((await me(acc)).scopes).toMatchObject({ fin: 'all', cps: 'own', reports: 'own' });
      const entries = await f.t.admin.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'role'), eq(auditLog.entityId, accRole.id)));
      const entry = entries.find((e) => JSON.stringify(e.changes).includes('"scopes"'));
      expect(entry!.changes).toEqual([
        { field: 'scopes', from: { fin: 'own' }, to: { fin: 'all' } },
      ]);

      const viewAll = await call('PATCH', `/api/roles/${accRole.id}`, owner, {
        version: saved.version,
        permissions: [...saved.permissions, 'viewAll'],
      });
      expect(viewAll.status).toBe(200);
      expect(Object.values((await me(acc)).scopes)).toEqual(SCOPE_GROUPS.map(() => 'all'));
      const restored = Role.parse(await viewAll.json());
      await call('PATCH', `/api/roles/${accRole.id}`, owner, {
        version: restored.version,
        permissions: saved.permissions,
        scopes: { fin: 'own' },
      });
      expect((await me(acc)).scopes).toMatchObject({ fin: 'own', cps: 'own' });
    });

    it('право группы без просмотра — 400 «Сначала дайте просмотр»; право только владельца — 403', async () => {
      const empty = await newRole('Проверка галочек');
      const noView = await call('PATCH', `/api/roles/${empty.id}`, owner, {
        version: empty.version,
        permissions: ['projects'],
      });
      expect(noView.status).toBe(400);
      expect(await apiErr(noView)).toEqual({
        code: 'view_required',
        message: 'Сначала дайте просмотр',
        details: { permission: 'projects' },
      });
      const org = await call('PATCH', `/api/roles/${empty.id}`, owner, {
        version: empty.version,
        permissions: ['org'],
      });
      expect(org.status).toBe(403);
      expect((await apiErr(org)).code).toBe('owner_only');
      expect((await role(empty.id)).permissions).toEqual([]);
      const ok = await call('PATCH', `/api/roles/${empty.id}`, owner, {
        version: empty.version,
        permissions: ['projects', 'projView', 'tasksCreate'],
      });
      expect(ok.status).toBe(200);
      expect(Role.parse(await ok.json()).permissions).toEqual([
        'projView',
        'projects',
        'tasksCreate',
      ]);
    });

    it('роль владельца не меняется; свою роль не владелец не меняет — ни права, ни область, ни название', async () => {
      const ownerRole = await role(f.a.roles.find((r) => r.isOwner)!.id);
      const res = await call('PATCH', `/api/roles/${ownerRole.id}`, owner, {
        version: ownerRole.version,
        name: 'Хозяин',
      });
      expect(res.status).toBe(403);
      expect((await apiErr(res)).code).toBe('owner_role');

      const hrRole = await role(f.roleIds.hr);
      for (const body of [
        { scopes: { cps: 'all' } },
        { name: 'Отдел кадров' },
        { permissions: [...hrRole.permissions, 'export'] },
      ]) {
        const own = await call('PATCH', `/api/roles/${hrRole.id}`, hr, {
          version: hrRole.version,
          ...body,
        });
        expect(own.status).toBe(403);
        expect(await apiErr(own)).toEqual({
          code: 'own_role',
          message: 'Права своей роли меняет владелец',
        });
      }
      // Без изменений — не ошибка.
      const same = await call('PATCH', `/api/roles/${hrRole.id}`, hr, {
        version: hrRole.version,
        name: hrRole.name,
      });
      expect(same.status).toBe(200);
    });

    it('не владелец не выдаёт и не снимает права «выдаёт только владелец», остальные — меняет', async () => {
      const accRole = await role(f.templateRole(f.a, 'acc'));
      const grant = await call('PATCH', `/api/roles/${accRole.id}`, hr, {
        version: accRole.version,
        permissions: [...accRole.permissions, 'rollback'],
      });
      expect(grant.status).toBe(403);
      expect(await apiErr(grant)).toMatchObject({
        code: 'owner_granted',
        details: { permission: 'rollback' },
      });
      const senior = await role(f.roleIds.senior);
      const revoke = await call('PATCH', `/api/roles/${senior.id}`, hr, {
        version: senior.version,
        permissions: ['cpView'],
      });
      expect(revoke.status).toBe(403);
      const other = await call('PATCH', `/api/roles/${senior.id}`, hr, {
        version: senior.version,
        permissions: ['cpView', 'createCp', 'rollback'],
        name: 'Старший (с откатом)',
      });
      expect(other.status).toBe(200);
      expect(Role.parse(await other.json())).toMatchObject({
        name: 'Старший (с откатом)',
        permissions: ['cpView', 'createCp', 'rollback'],
        audit: { updatedBy: 'hr-a' },
      });
    });

    it('устаревшая версия — 409, правка не затирает чужую; занятое название — 400', async () => {
      const r = await newRole('Версии');
      await call('PATCH', `/api/roles/${r.id}`, owner, { version: r.version, name: 'Версии 2' });
      const stale = await call('PATCH', `/api/roles/${r.id}`, owner, {
        version: r.version,
        permissions: ['export'],
      });
      expect(stale.status).toBe(409);
      expect((await apiErr(stale)).code).toBe('record_changed');
      expect(await role(r.id)).toMatchObject({ name: 'Версии 2', permissions: [] });
      const dup = await call('PATCH', `/api/roles/${r.id}`, owner, {
        version: r.version + 1,
        name: 'Бухгалтер',
      });
      expect(dup.status).toBe(400);
      expect((await apiErr(dup)).code).toBe('role_name_taken');
      const twice = await call('PATCH', `/api/roles/${r.id}`, owner, {
        version: r.version + 1,
        permissions: ['export', 'export'],
      });
      expect(twice.status).toBe(400);
      expect((await apiErr(twice)).code).toBe('validation_failed');
    });
  });

  describe('удаление роли', () => {
    it('неиспользуемая роль удаляется вместе с правами; в истории — удаление', async () => {
      const r = await newRole('На удаление', f.templateRole(f.a, 'acc'));
      const stale = await call('DELETE', `/api/roles/${r.id}?version=${r.version + 1}`, owner);
      expect(stale.status).toBe(409);
      const res = await call('DELETE', `/api/roles/${r.id}?version=${r.version}`, hr);
      expect(res.status).toBe(200);
      expect((await call('GET', `/api/roles/${r.id}`, owner)).status).toBe(404);
      const history = await f.t.admin.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'role'), eq(auditLog.entityId, r.id)));
      expect(history.at(-1)).toMatchObject({
        action: 'delete',
        changes: [{ field: 'name', from: 'На удаление' }],
      });
    });

    it('роль с сотрудниками, роль новых сотрудников и роль владельца не удаляются', async () => {
      const senior = await role(f.roleIds.senior);
      const used = await call('DELETE', `/api/roles/${senior.id}?version=${senior.version}`, owner);
      expect(used.status).toBe(400);
      expect((await apiErr(used)).code).toBe('role_in_use');

      // «Бухгалтер» — роль новых сотрудников по учётной политике; его сотрудника переводим.
      const accRole = await role(f.templateRole(f.a, 'acc'));
      const byDefault = await call(
        'DELETE',
        `/api/roles/${accRole.id}?version=${accRole.version}`,
        owner,
      );
      expect(byDefault.status).toBe(400);
      expect((await apiErr(byDefault)).code).toMatch(/^role_(in_use|is_default)$/);

      const ownerRole = await role(f.a.roles.find((r) => r.isOwner)!.id);
      const own = await call(
        'DELETE',
        `/api/roles/${ownerRole.id}?version=${ownerRole.version}`,
        owner,
      );
      expect(own.status).toBe(403);
      expect((await apiErr(own)).code).toBe('owner_role');
      expect((await call('DELETE', `/api/roles/${ownerRole.id}`, owner)).status).toBe(400);
      expect((await call('DELETE', `/api/roles/${ownerRole.id}?version=1`, acc)).status).toBe(403);
    });

    it('роль новых сотрудников без сотрудников — 400 «role_is_default»', async () => {
      const r = await newRole('По умолчанию');
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({ defaultRoleId: r.id })
        .where(eq(schema.orgSettings.orgId, f.a.orgId));
      const res = await call('DELETE', `/api/roles/${r.id}?version=${r.version}`, owner);
      expect(res.status).toBe(400);
      expect((await apiErr(res)).code).toBe('role_is_default');
    });
  });
});
