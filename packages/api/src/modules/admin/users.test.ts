import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  AdminUser,
  AdminUserList,
  ApiError,
  ListValues,
  MeResponse,
  TemporaryPasswordResponse,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Админка → «Учётные записи»', () => {
  let f: Fixture;
  let admin: string;
  let owner: string;

  beforeAll(async () => {
    f = await createStaffFixture();
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  const get = (path: string, cookie = admin) => apiRequest(f.app, 'GET', path, cookie);
  const post = (path: string, body: unknown, cookie = admin) =>
    apiRequest(f.app, 'POST', path, cookie, body);
  const account = async (login: string) => {
    const list = AdminUserList.parse(await (await get('/api/admin/users?size=all')).json());
    return list.items.find((u) => u.login === login)!;
  };
  const login = (name: string, password = TEST_PASSWORD) =>
    apiRequest(f.app, 'POST', '/api/auth/login', undefined, { login: name, password });

  it('только администратор платформы: сотруднику организации и без входа — отказ', async () => {
    for (const path of [
      '/api/admin/users',
      '/api/admin/users/values?col=active',
      '/api/admin/users/export?cols=login',
    ]) {
      expect((await get(path, owner)).status).toBe(403);
      expect((await get(path, '')).status).toBe(401);
    }
    const id = f.people['acc-a']!.userId;
    expect((await post(`/api/admin/users/${id}/block`, { version: 1 }, owner)).status).toBe(403);
    expect((await post(`/api/admin/users/${id}/unblock`, { version: 1 }, owner)).status).toBe(403);
  });

  it('список всех пользователей платформы: организация, ФИО, роль, статус; значения фильтра', async () => {
    const res = await get('/api/admin/users?sort=login.asc');
    expect(res.status).toBe(200);
    const list = AdminUserList.parse(await res.json());
    expect(list.total).toBe(8);
    expect(list.items.map((u) => u.login)).toEqual([
      'acc-a',
      'acc-b',
      'chief-a',
      'hr-a',
      'owner-a',
      'owner-b',
      'platform-admin',
      'senior-a',
    ]);
    const platform = list.items.find((u) => u.login === 'platform-admin')!;
    expect(platform).toMatchObject({
      fullName: 'Администратор платформы',
      orgName: 'Платформа',
      role: 'Администратор платформы',
      isPlatformAdmin: true,
      status: 'active',
    });
    expect(platform.lastLoginAt).not.toBeNull();
    expect(list.items.find((u) => u.login === 'acc-b')).toMatchObject({
      fullName: 'Сотрудник acc-b',
      orgName: 'Организация Б',
      role: 'Бухгалтер',
      isPlatformAdmin: false,
    });
    const values = ListValues.parse(await (await get('/api/admin/users/values?col=active')).json());
    expect(values.items).toEqual([{ value: 'active', label: 'Активен', count: 8 }]);
    const orgs = ListValues.parse(await (await get('/api/admin/users/values?col=org')).json());
    expect(orgs.items.map((v) => [v.value, v.count])).toEqual([
      ['Организация А', 5],
      ['Организация Б', 2],
      ['Платформа', 1],
    ]);
  });

  it('блокировка: пользователь не входит, открытый сеанс отказывает; разблокировка возвращает вход', async () => {
    const accB = await signIn(f.app, 'acc-b', TEST_PASSWORD);
    const before = await account('acc-b');
    const blocked = await post(`/api/admin/users/${before.id}/block`, { version: before.version });
    expect(blocked.status).toBe(200);
    const after = AdminUser.parse(await blocked.json());
    expect(after).toMatchObject({ blocked: true, status: 'blocked' });
    expect(after.audit.updatedBy).toBe('Администратор платформы');

    expect((await get('/api/auth/me', accB)).status).toBe(401);
    const denied = await login('acc-b');
    expect(denied.status).toBe(403);
    expect(ApiError.parse(await denied.json()).error.code).toBe('user_blocked');

    const stale = await post(`/api/admin/users/${before.id}/unblock`, { version: before.version });
    expect(stale.status).toBe(409);
    const unblocked = await post(`/api/admin/users/${before.id}/unblock`, {
      version: after.version,
    });
    expect(unblocked.status).toBe(200);
    expect(AdminUser.parse(await unblocked.json()).status).toBe('active');
    expect((await login('acc-b')).status).toBe(200);

    const [history] = await f.t.admin.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, before.id));
    expect(history).toBeTruthy();
  });

  it('сотрудник, заблокированный владельцем: свой статус, администратор его блокировку не снимает', async () => {
    await f.t.admin.db
      .update(schema.employees)
      .set({ active: false })
      .where(eq(schema.employees.id, f.people['hr-a']!.employeeId));
    const hr = await account('hr-a');
    expect(hr).toMatchObject({ status: 'owner_blocked', blocked: false });
    const unblocked = await post(`/api/admin/users/${hr.id}/unblock`, { version: hr.version });
    expect(unblocked.status).toBe(200);
    expect(AdminUser.parse(await unblocked.json()).status).toBe('owner_blocked');
    expect((await login('hr-a')).status).toBe(403);
    await f.t.admin.db
      .update(schema.employees)
      .set({ active: true })
      .where(eq(schema.employees.id, f.people['hr-a']!.employeeId));
  });

  it('свою учётную запись и администраторов платформы не блокируют; нет такой — 404', async () => {
    const self = await account('platform-admin');
    const codeOf = async (path: string, body: unknown) => {
      const res = await post(path, body);
      return [res.status, ApiError.safeParse(await res.json()).data?.error.code];
    };
    expect(await codeOf(`/api/admin/users/${self.id}/block`, { version: self.version })).toEqual([
      400,
      'account_self',
    ]);
    const [other] = await f.t.admin.db
      .insert(schema.users)
      .values({ login: 'platform-second', passwordHash: '!', isPlatformAdmin: true })
      .returning({ id: schema.users.id });
    expect(await codeOf(`/api/admin/users/${other!.id}/block`, { version: 1 })).toEqual([
      400,
      'account_platform_admin',
    ]);
    expect(
      await codeOf('/api/admin/users/00000000-0000-4000-8000-00000000abcd/block', { version: 1 }),
    ).toEqual([404, 'not_found']);
  });

  it('сброс пароля: временный пароль, прежний не подходит, при входе — сменить пароль', async () => {
    const chief = await account('chief-a');
    const res = await post(`/api/admin/users/${chief.id}/password-reset`, {});
    expect(res.status).toBe(200);
    const { temporaryPassword } = TemporaryPasswordResponse.parse(await res.json());
    expect((await login('chief-a')).status).toBe(401);
    const signed = await login('chief-a', temporaryPassword);
    expect(signed.status).toBe(200);
    expect(MeResponse.parse(await signed.json()).user.mustChangePassword).toBe(true);
  });

  it('выгрузка в Excel: видимые столбцы, организации и подписи статусов', async () => {
    const res = await get(
      '/api/admin/users/export?cols=login,fullName,org,role,active&sort=login.asc',
    );
    expect(res.status).toBe(200);
    const files = unzipTexts(new Uint8Array(await res.arrayBuffer()));
    const sheet = Object.entries(files).find(([name]) => name.includes('sheet1'))?.[1] ?? '';
    const shared =
      Object.entries(files).find(([name]) => name.includes('sharedStrings'))?.[1] ?? '';
    const text = sheet + shared;
    expect(text).toContain('owner-b');
    expect(text).toContain('Платформа');
    expect(text).toContain('Активен');
  });
});
