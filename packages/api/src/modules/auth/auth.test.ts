import { hashPassword } from '@buhuchet/adapters/password';
import { hashSessionToken } from '@buhuchet/adapters/tokens';
import { createRoute, z } from '@hono/zod-openapi';
import { schema, withOrgContext } from '@buhuchet/db';
import { createOrganization, type CreatedOrganization } from '@buhuchet/db/organizations';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedPhoneCodes,
  type TestDatabase,
} from '@buhuchet/db/testing';
import { MENU_MODULES, scopeOf } from '@buhuchet/domain';
import { ApiError, MeResponse } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { cookieOf, createTestDeps, signIn, TEST_ORIGIN as ORIGIN } from '../../testing';

const { auditLog, employees, loginAttempts, organizations, sessions, users } = schema;

const PASSWORD = 'Верный-пароль-1';

type App = ReturnType<typeof createApp>;

/**
 * Приложение с двумя проверочными методами: «Сотрудники» с правом «Просматривать сотрудников» —
 * так, как метод подключает право (`createRoute({ middleware })`), и метод для любого сотрудника.
 */
function appWithProbes(deps: ApiDeps): App {
  const app = createApp(deps);
  app.openapi(
    createRoute({
      method: 'get',
      path: '/probe/staff',
      middleware: [requirePermission('staffView')] as const,
      responses: {
        200: {
          description: 'Сотрудники своей организации',
          content: {
            'application/json': {
              schema: z.array(z.object({ id: z.string(), orgId: z.string() })),
            },
          },
        },
      },
    }),
    async (c) =>
      c.json(
        await withOrgContext(deps.db, orgContextOf(c), (tx) =>
          tx.select({ id: employees.id, orgId: employees.orgId }).from(employees),
        ),
        200,
      ),
  );
  // Метод, где забыли проверку права: без организации в сеансе orgContextOf сам отвечает 403.
  app.get('/probe/unguarded', async (c) =>
    c.json(await withOrgContext(deps.db, orgContextOf(c), async () => ({ ok: true }))),
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
    await seedPhoneCodes(t.admin.db);
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
      ['pwlock-a', 'acc'],
      ['race-a', 'acc'],
      ['twin-a', 'acc'],
      ['clear-a', 'acc'],
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
      employee: { shortName: 'acc-a', phone: null, roleName: 'Бухгалтер', isOwner: false },
      organization: { id: a.orgId, name: 'Организация А', slug: 'org-a', inn: '01811201810456' },
      scopes: { cps: 'own', reports: 'own' },
      // Подтверждение сдачи у новой организации включено (учётная политика по умолчанию).
      reportConfirm: true,
    });
    expect(me.permissions).toContain('cpView');
    expect(me.permissions).not.toContain('staffView');
    // Меню сотрудника — только модули Бизнеса, модулей Админки в нём нет.
    expect(me.modules).toContain('home');
    expect(me.modules.filter((m) => !MENU_MODULES.some((b) => b.id === m))).toEqual([]);

    const again = await get(app, '/api/auth/me', cookieOf(res));
    expect(again.status).toBe(200);
    expect(MeResponse.parse(await again.json())).toEqual(me);
    // В базе — только хеш токена.
    const token = cookieOf(res).split('=')[1]!;
    const stored = await t.admin.db.select({ tokenHash: sessions.tokenHash }).from(sessions);
    expect(stored.some((s) => s.tokenHash === token)).toBe(false);
  });

  it('«кто я» показывает телефон сотрудника по маске страны («Мой профиль»)', async () => {
    await t.admin.db
      .update(employees)
      .set({ phone: '+996555100200' })
      .where(eq(employees.shortName, 'chief-a'));
    const res = await login(app, 'chief-a');
    expect(res.status).toBe(200);
    expect(MeResponse.parse(await res.json()).employee).toMatchObject({
      fullName: 'Сотрудник chief-a',
      phone: '+996 555 100 200',
    });
  });

  it('неизвестный логин и неверный пароль — один ответ «Неверный логин или пароль»', async () => {
    const unknown = await login(app, 'nobody');
    const wrong = await login(app, 'wrong-a', 'не-тот-пароль');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    const expected = {
      error: { code: 'invalid_credentials', message: 'Неверный логин или пароль' },
    };
    expect(await unknown.json()).toEqual(expected);
    expect(await wrong.json()).toEqual(expected);
    expect(wrong.headers.get('set-cookie')).toBeNull();
    expect(unknown.headers.get('set-cookie')).toBeNull();
  });

  it('верный пароль снимает счёт неверных: после него снова пять попыток', async () => {
    for (let i = 1; i <= 4; i++) {
      expect((await login(app, 'clear-a', `неверный-${i}`)).status).toBe(401);
    }
    expect((await login(app, 'clear-a')).status).toBe(200);
    for (let i = 1; i <= 4; i++) {
      expect(await errorCode(await login(app, 'clear-a', `неверный-${i}`))).toBe(
        'invalid_credentials',
      );
    }
    expect((await login(app, 'clear-a')).status).toBe(200);
  });

  it('5 неверных паролей подряд — вход закрыт на 15 минут, даже с верным паролем', async () => {
    for (let i = 1; i <= 4; i++) {
      const res = await login(app, 'lock-a', `неверный-${i}`);
      expect(res.status).toBe(401);
      expect(await errorCode(res)).toBe('invalid_credentials');
    }
    const fifth = await login(app, 'lock-a', 'неверный-5');
    expect(fifth.status).toBe(429);
    const body = ApiError.parse(await fifth.json());
    expect(body.error).toMatchObject({
      code: 'login_locked',
    });
    expect(body.error.message).toMatch(
      /^Слишком много неверных паролей\. Вход закрыт на 15 минут, попробуйте снова после \d{2}:\d{2}\.$/,
    );
    const retryAfter = Number(fifth.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(14 * 60);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    // Для текста словаря err.login_locked — минуты и время по Бишкеку, как в тексте сервера.
    const details = body.error.details as { lockedUntil: string; minutes: number; time: string };
    expect(details.lockedUntil).toMatch(/^\d{4}-/);
    expect(details.minutes).toBe(15);
    expect(body.error.message).toContain(`после ${details.time}.`);

    const correct = await login(app, 'lock-a');
    expect(correct.status).toBe(429);
    expect(await errorCode(correct)).toBe('login_locked');

    // Прошло 15 минут — верный пароль снова пускает.
    await t.admin.db
      .update(loginAttempts)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(loginAttempts.login, 'lock-a'));
    expect((await login(app, 'lock-a')).status).toBe(200);
  });

  it('логин, которого нет, закрывается так же: те же ответы, «вход закрыт» на пятой попытке', async () => {
    const answers = async (name: string) => {
      const out: { status: number; code: string; retry: boolean }[] = [];
      for (let i = 1; i <= 6; i++) {
        const res = await login(app, name, `неверный-${i}`);
        out.push({
          status: res.status,
          code: await errorCode(res),
          retry: res.headers.get('retry-after') !== null,
        });
      }
      return out;
    };
    const ghost = await answers('ghost-login');
    expect(ghost).toEqual(await answers('twin-a'));
    expect(ghost.map((a) => a.status)).toEqual([401, 401, 401, 401, 429, 429]);
    expect(ghost[4]).toEqual({ status: 429, code: 'login_locked', retry: true });
  });

  it('одновременные неверные пароли: проверяются только пять, остальным — «вход закрыт»', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => login(app, 'race-a', `неверный-${i}`)),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(4);
    expect(statuses.filter((s) => s === 429)).toHaveLength(16);
    // Верный пароль после пятой занятой попытки — тоже «вход закрыт», блокировка не снимается.
    expect(await errorCode(await login(app, 'race-a'))).toBe('login_locked');
    const [race] = await t.admin.db
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.login, 'race-a'));
    expect(race!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
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

    expect(await errorCode(await login(app, 'chief-a'))).toBe('invalid_credentials');
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
    const [acc] = await t.admin.db
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.login, 'acc-a'));
    expect(acc!.failures).toBe(1);

    const short = await app.request(
      '/api/auth/password',
      json({ currentPassword: PASSWORD, newPassword: '1234567' }, { cookie }),
    );
    expect(short.status).toBe(400);
    expect(await errorCode(short)).toBe('validation_failed');
    expect((await get(app, '/api/auth/me', cookie)).status).toBe(200);
  });

  it('пятый неверный текущий пароль подряд закрывает вход на 15 минут — 429', async () => {
    const cookie = await signIn(app, 'pwlock-a', PASSWORD);
    const attempt = () =>
      app.request(
        '/api/auth/password',
        json({ currentPassword: 'не-тот', newPassword: 'Новый-пароль-2' }, { cookie }),
      );
    for (let i = 1; i <= 4; i++) expect((await attempt()).status).toBe(400);
    const fifth = await attempt();
    expect(fifth.status).toBe(429);
    expect(await errorCode(fifth)).toBe('login_locked');
    expect(await errorCode(await attempt())).toBe('login_locked');
    expect(await errorCode(await login(app, 'pwlock-a'))).toBe('login_locked');
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
    // С неверным паролем о блокировке не сообщается (docs/deviations.md, п. 4, решение Б).
    expect(await errorCode(await login(app, 'blocked-a', 'не-тот-пароль'))).toBe(
      'invalid_credentials',
    );
  });

  it('учётная запись, заблокированная администратором платформы, не входит (текст — как в прототипе)', async () => {
    await t.admin.db.update(users).set({ blocked: true }).where(eq(users.login, 'banned-a'));
    const res = await login(app, 'banned-a');
    expect(res.status).toBe(403);
    expect(ApiError.parse(await res.json()).error).toMatchObject({
      code: 'user_blocked',
      message: 'Учётная запись заблокирована. Обратитесь к владельцу организации.',
    });
    expect(await errorCode(await login(app, 'banned-a', 'не-тот-пароль'))).toBe(
      'invalid_credentials',
    );
  });

  it('сотрудники заблокированной организации видят сообщение о блокировке', async () => {
    const cookie = await signIn(app, 'owner-c', PASSWORD);
    await t.admin.db
      .update(organizations)
      .set({ status: 'blocked', blockedReason: 'Заблокирована администратором' })
      .where(eq(organizations.id, c.orgId));
    const expected = {
      code: 'org_blocked',
      message: 'Организация Организация В заблокирована. Обратитесь к администратору платформы.',
      details: { org: 'Организация В' },
    };
    const open = await get(app, '/api/auth/me', cookie);
    expect(open.status).toBe(403);
    expect(ApiError.parse(await open.json()).error).toMatchObject(expected);
    const res = await login(app, 'owner-c');
    expect(res.status).toBe(403);
    expect(ApiError.parse(await res.json()).error).toMatchObject(expected);
    // О блокировке сообщается только после верного пароля (docs/deviations.md, п. 4, решение Б).
    const wrong = await login(app, 'owner-c', 'не-тот-пароль');
    expect(wrong.status).toBe(401);
    expect(await errorCode(wrong)).toBe('invalid_credentials');

    // После разблокировки сотрудники снова входят и видят свои данные.
    await t.admin.db
      .update(organizations)
      .set({ status: 'active', blockedReason: null })
      .where(eq(organizations.id, c.orgId));
    const back = await signIn(app, 'owner-c', PASSWORD);
    const seen = (await (await get(app, '/api/probe/staff', back)).json()) as { orgId: string }[];
    expect(seen).toEqual([{ id: c.ownerEmployeeId, orgId: c.orgId }]);
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
      reportConfirm: false,
      // Меню Админки — все её модули по порядку (прототип core/registry.js, ADM).
      modules: ['accounts', 'orgs', 'pdicts', 'l10n', 'kb', 'kbadm', 'tg'],
    });
    const cookie = cookieOf(res);
    expect((await get(app, '/api/auth/me', cookie)).status).toBe(200);
    expect(await errorCode(await get(app, '/api/probe/staff', cookie))).toBe('forbidden');
    expect(await errorCode(await get(app, '/api/probe/scope', cookie))).toBe('forbidden');
    const unguarded = await get(app, '/api/probe/unguarded', cookie);
    expect(unguarded.status).toBe(403);
    expect(await errorCode(unguarded)).toBe('forbidden');

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
    // Заголовкам прокси не верим: подставленный X-Forwarded-Host не делает чужой Origin своим.
    const spoofed = await app.request(
      '/api/auth/logout',
      json({}, { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' }),
    );
    expect(spoofed.status).toBe(403);
    // Проверяются все изменяющие методы, не только POST.
    const patch = await app.request('/api/auth/me', { method: 'PATCH' });
    expect(await errorCode(patch)).toBe('origin_mismatch');
    // Адрес сайта из APP_BASE_URL — свой, даже если запрос пришёл на внутренний адрес.
    const site = appWithProbes(
      createTestDeps({
        db: t.app.db,
        config: { ...deps.config, APP_BASE_URL: 'https://test.buhuchet.kg' },
      }),
    );
    const fromSite = await site.request(
      '/api/auth/login',
      json({ login: 'acc-a', password: PASSWORD }, { origin: 'https://test.buhuchet.kg' }),
    );
    expect(fromSite.status).toBe(200);
    // Планировщик вызывает со своим секретом, без Origin.
    expect(await errorCode(await app.request('/api/cron/tick', { method: 'POST' }))).toBe(
      'cron_unauthorized',
    );
  });

  it('сайт по https — cookie с приставкой __Host- и Secure, даже если забыли APP_ENV', async () => {
    const https = appWithProbes(
      createTestDeps({
        db: t.app.db,
        config: { ...deps.config, APP_ENV: 'local', APP_BASE_URL: 'https://buhuchet.example' },
      }),
    );
    const res = await https.request(
      '/api/auth/login',
      json({ login: 'acc-a', password: PASSWORD }, { origin: 'https://buhuchet.example' }),
    );
    expect(res.headers.get('set-cookie')).toMatch(/^__Host-bh_session=.*Secure/);
  });

  it('слишком большой запрос — 413 до проверки пароля', async () => {
    const res = await app.request(
      '/api/auth/login',
      json({ login: 'acc-a', password: 'x'.repeat(2 * 1024 * 1024) }),
    );
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe('payload_too_large');
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

  it('показ страницы сервером сеанс не продлевает: продление остаётся запросам самой страницы', async () => {
    const cookie = await signIn(app, 'acc-a', PASSWORD);
    const thisSession = eq(sessions.tokenHash, hashSessionToken(cookie.split('=')[1]!));
    const stale = new Date(Date.now() - 2 * 3600_000);
    await t.admin.db.update(sessions).set({ lastSeenAt: stale }).where(thisSession);
    const lastSeen = async () =>
      (await t.admin.db.select().from(sessions).where(thisSession))[0]!.lastSeenAt.getTime();

    const page = await app.request('/api/auth/me', { headers: { cookie } }, { pageRender: true });
    expect(page.status).toBe(200);
    expect(page.headers.get('set-cookie')).toBeNull();
    expect(await lastSeen()).toBe(stale.getTime());

    const own = await get(app, '/api/auth/me', cookie);
    expect(cookieOf(own)).toBe(cookie);
    expect(await lastSeen()).toBeGreaterThan(stale.getTime());
  });

  it('неизвестный метод после входа — 404', async () => {
    const cookie = await signIn(app, 'acc-a', PASSWORD);
    const res = await get(app, '/api/nope', cookie);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('not_found');
  });
});
