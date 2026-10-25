import { hashPassword } from '@buhuchet/adapters/password';
import { schema, withOrgContext } from '@buhuchet/db';
import { createOrganization, type CreatedOrganization } from '@buhuchet/db/organizations';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from '@buhuchet/db/testing';
import { scopeOf } from '@buhuchet/domain';
import { ApiError, MeResponse } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { cookieOf, createTestDeps, signIn, TEST_ORIGIN as ORIGIN } from '../../testing';

const { auditLog, employees, organizations, sessions, users } = schema;

const PASSWORD = 'Верный-пароль-1';

type App = ReturnType<typeof createApp>;

/** Приложение с двумя проверочными методами: с правом «Просматривать сотрудников» и для любого сотрудника. */
function appWithProbes(deps: ApiDeps): App {
  const app = createApp(deps);
  app.get('/probe/staff', requirePermission('staffView'), async (c) =>
    c.json(
      await withOrgContext(deps.db, orgContextOf(c), (tx) =>
        tx.select({ id: employees.id, orgId: employees.orgId }).from(employees),
      ),
    ),
  );
  app.get('/probe/scope', requireEmployee, (c) =>
    c.json({ cps: scopeOf(c.get('access')!.subject, 'cps') }),
  );
  return app;
}

const json = (body: unknown, extra: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { origin: ORIGIN, 'content-type': 'application/json', ...extra },
  body: JSON.stringify(body),
});

function login(app: App, loginName: string, password = PASSWORD, cookie?: string) {
  return app.request(
    '/api/auth/login',
    json({ login: loginName, password }, cookie ? { cookie } : {}),
  );
}

const get = (app: App, path: string, cookie?: string) =>
  app.request(path, { headers: cookie ? { cookie } : {} });

async function errorCode(res: Response): Promise<string> {
  return ApiError.parse(await res.json()).error.code;
}

describe.skipIf(!databaseAvailable())('вход, сеансы и проверка прав', () => {
  let t: TestDatabase;
  let deps: ApiDeps;
  let app: App;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let c: CreatedOrganization;

  async function addEmployee(org: CreatedOrganization, login: string, template: string) {
    const passwordHash = await hashPassword(PASSWORD);
    const [user] = await t.admin.db
      .insert(users)
      .values({ orgId: org.orgId, login, passwordHash })
      .returning({ id: users.id });
    const [employee] = await t.admin.db
      .insert(employees)
      .values({
        orgId: org.orgId,
        userId: user!.id,
        fullName: `Сотрудник ${login}`,
        shortName: login,
        roleId: org.roles.find((r) => r.templateCode === template)!.id,
      })
      .returning({ id: employees.id });
    return { userId: user!.id, employeeId: employee!.id };
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedAccessReference(t.admin.db);
    const passwordHash = await hashPassword(PASSWORD);
    await t.admin.db
      .insert(users)
      .values({ login: 'platform-admin', passwordHash, isPlatformAdmin: true });
    const org = (n: string, inn: string, slug: string, owner: string) =>
      createOrganization(t.app.db, {
        name: n,
        inn,
        slug,
        owner: { fullName: `Владелец ${owner}`, login: owner, passwordHash },
      });
    a = await org('Организация А', '01811201810456', 'org-a', 'owner-a');
    b = await org('Организация Б', '02811201810457', 'org-b', 'owner-b');
    c = await org('Организация В', '03811201810458', 'org-c', 'owner-c');
    // Владельцы Б и В уже сменили временный пароль; владелец А — ещё нет.
    await t.admin.db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.login, 'owner-b'));
    await t.admin.db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.login, 'owner-c'));
    for (const [login, template] of [
      ['acc-a', 'acc'],
      ['chief-a', 'chief'],
      ['lock-a', 'acc'],
      ['blocked-a', 'acc'],
      ['banned-a', 'acc'],
      ['wrong-a', 'acc'],
    ] as const) {
      await addEmployee(a, login, template);
    }
    deps = createTestDeps({ db: t.app.db });
    app = appWithProbes(deps);
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('верный логин и пароль — вход; cookie HttpOnly, SameSite=Lax; «кто я» отвечает тем же', async () => {
    const res = await login(app, 'ACC-A');
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/^bh_session=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
    const me = MeResponse.parse(await res.json());
    expect(me).toMatchObject({
      user: { login: 'acc-a', isPlatformAdmin: false, mustChangePassword: false },
      employee: { shortName: 'acc-a', roleName: 'Бухгалтер', isOwner: false },
      organization: { id: a.orgId, name: 'Организация А', slug: 'org-a' },
      scopes: { cps: 'own', reports: 'own' },
    });
    expect(me.permissions).toContain('cpView');
    expect(me.permissions).not.toContain('staffView');

    const again = await get(app, '/api/auth/me', cookieOf(res));
    expect(again.status).toBe(200);
    expect(MeResponse.parse(await again.json())).toEqual(me);
    // В базе — только хеш токена.
    const token = cookieOf(res).split('=')[1]!;
    const stored = await t.admin.db.select({ tokenHash: sessions.tokenHash }).from(sessions);
    expect(stored.some((s) => s.tokenHash === token)).toBe(false);
  });

  it('нет такого логина — «Нет такого логина»; неверный пароль — предупреждение о блокировке', async () => {
    const unknown = await login(app, 'nobody');
    expect(unknown.status).toBe(401);
    expect(ApiError.parse(await unknown.json()).error).toMatchObject({
      code: 'unknown_login',
      message: 'Нет такого логина',
    });
    const wrong = await login(app, 'wrong-a', 'не-тот-пароль');
    expect(wrong.status).toBe(401);
    expect(ApiError.parse(await wrong.json()).error).toMatchObject({
      code: 'wrong_password',
      message: 'Неверный пароль. После 5 неверных попыток вход блокируется на 15 минут.',
    });
    expect(wrong.headers.get('set-cookie')).toBeNull();
  });

  it('5 неверных паролей подряд — вход закрыт на 15 минут, даже с верным паролем', async () => {
    for (let i = 1; i <= 4; i++) {
      const res = await login(app, 'lock-a', `неверный-${i}`);
      expect(res.status).toBe(401);
      expect(await errorCode(res)).toBe('wrong_password');
    }
    const fifth = await login(app, 'lock-a', 'неверный-5');
    expect(fifth.status).toBe(429);
    const body = ApiError.parse(await fifth.json());
    expect(body.error).toMatchObject({
      code: 'login_locked',
      message: 'Слишком много неверных паролей. Вход закрыт на 15 минут.',
    });
    const retryAfter = Number(fifth.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(14 * 60);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    expect((body.error.details as { lockedUntil: string }).lockedUntil).toMatch(/^\d{4}-/);

    const correct = await login(app, 'lock-a');
    expect(correct.status).toBe(429);
    expect(await errorCode(correct)).toBe('login_locked');

    // Прошло 15 минут — верный пароль снова пускает.
    await t.admin.db
      .update(users)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(users.login, 'lock-a'));
    expect((await login(app, 'lock-a')).status).toBe(200);
  });

  it('без входа — 401; испорченная или чужая cookie — 401, cookie стирается', async () => {
    const none = await get(app, '/api/auth/me');
    expect(none.status).toBe(401);
    expect(await errorCode(none)).toBe('unauthorized');
    expect((await get(app, '/api/probe/staff')).status).toBe(401);

    const garbage = await get(app, '/api/auth/me', 'bh_session=garbage!');
    expect(garbage.status).toBe(401);
    const forged = await get(app, '/api/auth/me', `bh_session=${'A'.repeat(43)}`);
    expect(forged.status).toBe(401);
    expect(forged.headers.get('set-cookie')).toMatch(/^bh_session=;.*Max-Age=0/);
  });

  it('метод без нужного права — 403, с правом — 200', async () => {
    const acc = await signIn(app, 'acc-a', PASSWORD);
    const denied = await get(app, '/api/probe/staff', acc);
    expect(denied.status).toBe(403);
    expect(await errorCode(denied)).toBe('forbidden');
    expect(await (await get(app, '/api/probe/scope', acc)).json()).toEqual({ cps: 'own' });

    const chief = await signIn(app, 'chief-a', PASSWORD);
    expect((await get(app, '/api/probe/staff', chief)).status).toBe(200);
    expect(await (await get(app, '/api/probe/scope', chief)).json()).toEqual({ cps: 'all' });
  });

  it('организация А не получает данных организации Б', async () => {
    const chiefA = await signIn(app, 'chief-a', PASSWORD);
    const seenA = (await (await get(app, '/api/probe/staff', chiefA)).json()) as {
      orgId: string;
    }[];
    expect(seenA.length).toBeGreaterThan(1);
    expect(seenA.every((e) => e.orgId === a.orgId)).toBe(true);

    const ownerB = await signIn(app, 'owner-b', PASSWORD);
    const seenB = (await (await get(app, '/api/probe/staff', ownerB)).json()) as {
      orgId: string;
    }[];
    expect(seenB).toEqual([{ id: b.ownerEmployeeId, orgId: b.orgId }]);
    const meB = MeResponse.parse(await (await get(app, '/api/auth/me', ownerB)).json());
    expect(meB.organization?.id).toBe(b.orgId);
    expect(meB.employee).toMatchObject({ id: b.ownerEmployeeId, isOwner: true });
  });

  it('после выхода старая cookie не действует', async () => {
    const cookie = await signIn(app, 'acc-a', PASSWORD);
    const out = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { origin: ORIGIN, cookie },
    });
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ ok: true });
    expect(out.headers.get('set-cookie')).toMatch(/^bh_session=;.*Max-Age=0/);
    expect((await get(app, '/api/auth/me', cookie)).status).toBe(401);
    // Повторный выход без сеанса — тоже успешен.
    expect(
      (await app.request('/api/auth/logout', { method: 'POST', headers: { origin: ORIGIN } }))
        .status,
    ).toBe(200);
  });

  it('повторный вход в том же браузере закрывает прежний сеанс', async () => {
    const first = await signIn(app, 'acc-a', PASSWORD);
    const second = cookieOf(await login(app, 'acc-a', PASSWORD, first));
    expect((await get(app, '/api/auth/me', first)).status).toBe(401);
    expect((await get(app, '/api/auth/me', second)).status).toBe(200);
  });

  it('после смены пароля старая cookie не действует; другие сеансы закрыты', async () => {
    const c1 = await signIn(app, 'chief-a', PASSWORD);
    const c2 = await signIn(app, 'chief-a', PASSWORD);
    const changed = await app.request(
      '/api/auth/password',
      json({ currentPassword: PASSWORD, newPassword: 'Новый-пароль-2' }, { cookie: c1 }),
    );
    expect(changed.status).toBe(200);
    const rotated = cookieOf(changed);
    expect(rotated).not.toBe(c1);
    expect((await get(app, '/api/auth/me', c1)).status).toBe(401);
    expect((await get(app, '/api/auth/me', c2)).status).toBe(401);
    expect((await get(app, '/api/auth/me', rotated)).status).toBe(200);

    expect(await errorCode(await login(app, 'chief-a'))).toBe('wrong_password');
    expect((await login(app, 'chief-a', 'Новый-пароль-2')).status).toBe(200);

    // В истории — что пароль сменён, без значений.
    const [chief] = await t.admin.db.select().from(users).where(eq(users.login, 'chief-a'));
    const history = await t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, chief!.id)));
    expect(history.map((h) => [h.action, h.changes, h.actorUserId])).toEqual([
      ['update', [{ field: 'passwordHash' }], chief!.id],
    ]);
  });

  it('неверный текущий пароль — 400 и считается неверной попыткой; новый короче 8 — 400', async () => {
    const cookie = await signIn(app, 'acc-a', PASSWORD);
    const wrong = await app.request(
      '/api/auth/password',
      json({ currentPassword: 'не-тот', newPassword: 'Новый-пароль-2' }, { cookie }),
    );
    expect(wrong.status).toBe(400);
    expect(ApiError.parse(await wrong.json()).error).toMatchObject({
      code: 'current_password_invalid',
      message: 'Текущий пароль неверный',
    });
    const [acc] = await t.admin.db.select().from(users).where(eq(users.login, 'acc-a'));
    expect(acc!.failedLogins).toBe(1);

    const short = await app.request(
      '/api/auth/password',
      json({ currentPassword: PASSWORD, newPassword: '1234567' }, { cookie }),
    );
    expect(short.status).toBe(400);
    expect(await errorCode(short)).toBe('validation_failed');
    expect((await get(app, '/api/auth/me', cookie)).status).toBe(200);
  });

  it('временный пароль: до смены доступны только «кто я» и смена пароля', async () => {
    const res = await login(app, 'owner-a');
    expect(res.status).toBe(200);
    expect(MeResponse.parse(await res.json()).user.mustChangePassword).toBe(true);
    const cookie = cookieOf(res);
    const blocked = await get(app, '/api/probe/staff', cookie);
    expect(blocked.status).toBe(403);
    expect(await errorCode(blocked)).toBe('password_change_required');
    expect((await get(app, '/api/auth/me', cookie)).status).toBe(200);

    const changed = await app.request(
      '/api/auth/password',
      json({ currentPassword: PASSWORD, newPassword: 'Свой-пароль-3' }, { cookie }),
    );
    expect(changed.status).toBe(200);
    const fresh = cookieOf(changed);
    expect((await get(app, '/api/probe/staff', fresh)).status).toBe(200);
    const me = MeResponse.parse(await (await get(app, '/api/auth/me', fresh)).json());
    expect(me.user.mustChangePassword).toBe(false);
    expect(me.permissions).toContain('org');

    const [owner] = await t.admin.db.select().from(users).where(eq(users.login, 'owner-a'));
    const history = await t.admin.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, 'user'),
          eq(auditLog.entityId, owner!.id),
          eq(auditLog.action, 'update'),
        ),
      );
    expect(history.map((h) => h.changes)).toEqual([
      [{ field: 'passwordHash' }, { field: 'mustChangePassword', from: true, to: false }],
    ]);
  });

  it('заблокированный сотрудник не входит, его открытый сеанс закрывается', async () => {
    const cookie = await signIn(app, 'blocked-a', PASSWORD);
    await t.admin.db
      .update(employees)
      .set({ active: false })
      .where(eq(employees.shortName, 'blocked-a'));
    const now = await get(app, '/api/auth/me', cookie);
    expect(now.status).toBe(403);
    expect(ApiError.parse(await now.json()).error).toMatchObject({
      code: 'employee_blocked',
      message: 'Учётная запись заблокирована. Обратитесь к владельцу организации.',
    });
    expect((await get(app, '/api/auth/me', cookie)).status).toBe(401);

    const again = await login(app, 'blocked-a');
    expect(again.status).toBe(403);
    expect(await errorCode(again)).toBe('employee_blocked');
  });

  it('учётная запись, заблокированная администратором платформы, не входит', async () => {
    await t.admin.db.update(users).set({ blocked: true }).where(eq(users.login, 'banned-a'));
    const res = await login(app, 'banned-a');
    expect(res.status).toBe(403);
    expect(ApiError.parse(await res.json()).error).toMatchObject({
      code: 'user_blocked',
      message: 'Учётная запись заблокирована. Обратитесь к администратору платформы.',
    });
  });

  it('сотрудники заблокированной организации видят сообщение о блокировке', async () => {
    const cookie = await signIn(app, 'owner-c', PASSWORD);
    await t.admin.db
      .update(organizations)
      .set({ status: 'blocked', blockedReason: 'Неоплата' })
      .where(eq(organizations.id, c.orgId));
    const expected = {
      code: 'org_blocked',
      message: 'Организация Организация В заблокирована. Обратитесь к администратору платформы.',
    };
    const open = await get(app, '/api/auth/me', cookie);
    expect(open.status).toBe(403);
    expect(ApiError.parse(await open.json()).error).toMatchObject(expected);
    const res = await login(app, 'owner-c');
    expect(res.status).toBe(403);
    expect(ApiError.parse(await res.json()).error).toMatchObject(expected);
  });

  it('администратор платформы входит без организации и без прав в организациях', async () => {
    const res = await login(app, 'platform-admin');
    expect(res.status).toBe(200);
    expect(MeResponse.parse(await res.json())).toMatchObject({
      user: { login: 'platform-admin', isPlatformAdmin: true },
      employee: null,
      organization: null,
      permissions: [],
      scopes: {},
    });
    const cookie = cookieOf(res);
    expect((await get(app, '/api/auth/me', cookie)).status).toBe(200);
    expect(await errorCode(await get(app, '/api/probe/staff', cookie))).toBe('forbidden');
    expect(await errorCode(await get(app, '/api/probe/scope', cookie))).toBe('forbidden');

    const changed = await app.request(
      '/api/auth/password',
      json({ currentPassword: PASSWORD, newPassword: 'Админ-пароль-4' }, { cookie }),
    );
    expect(changed.status).toBe(200);
    expect((await get(app, '/api/auth/me', cookie)).status).toBe(401);
    expect((await get(app, '/api/auth/me', cookieOf(changed))).status).toBe(200);
  });

  it('изменяющий запрос с чужого сайта или без Origin — 403', async () => {
    const evil = await app.request(
      '/api/auth/login',
      json({ login: 'acc-a', password: PASSWORD }, { origin: 'https://evil.example' }),
    );
    expect(evil.status).toBe(403);
    expect(await errorCode(evil)).toBe('origin_mismatch');
    const noOrigin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'acc-a', password: PASSWORD }),
    });
    expect(noOrigin.status).toBe(403);
    // За прокси (Vercel) адрес сайта — в x-forwarded-host.
    const proxied = await app.request(
      '/api/auth/login',
      json(
        { login: 'acc-a', password: PASSWORD },
        { origin: 'https://test.buhuchet.kg', 'x-forwarded-host': 'test.buhuchet.kg' },
      ),
    );
    expect(proxied.status).toBe(200);
    // Планировщик вызывает со своим секретом, без Origin.
    expect(await errorCode(await app.request('/api/cron/tick', { method: 'POST' }))).toBe(
      'cron_unauthorized',
    );
  });

  it('на стенде и рабочем сайте cookie — с приставкой __Host- и Secure', async () => {
    const staging = appWithProbes(
      createTestDeps({ db: t.app.db, config: { ...deps.config, APP_ENV: 'staging' } }),
    );
    const res = await login(staging, 'acc-a');
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/^__Host-bh_session=/);
    expect(setCookie).toContain('Secure');
    const cookie = cookieOf(res);
    expect((await get(staging, '/api/auth/me', cookie)).status).toBe(200);
    // Cookie без приставки на стенде не принимается.
    expect((await get(staging, '/api/auth/me', cookie.replace('__Host-', ''))).status).toBe(401);
  });

  it('сеанс продлевается не чаще раза в час: тогда cookie выдаётся заново', async () => {
    const cookie = await signIn(app, 'acc-a', PASSWORD);
    expect((await get(app, '/api/auth/me', cookie)).headers.get('set-cookie')).toBeNull();
    await t.admin.db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - 2 * 3600_000) })
      .where(
        eq(
          sessions.userId,
          (await t.admin.db.select().from(users).where(eq(users.login, 'acc-a')))[0]!.id,
        ),
      );
    const touched = await get(app, '/api/auth/me', cookie);
    expect(touched.status).toBe(200);
    expect(cookieOf(touched)).toBe(cookie);
  });

  it('неизвестный метод после входа — 404', async () => {
    const cookie = await signIn(app, 'acc-a', PASSWORD);
    const res = await get(app, '/api/nope', cookie);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('not_found');
  });
});
