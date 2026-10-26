import { createFakeTelegram, type FakeTelegram } from '@buhuchet/adapters';
import { hashPassword } from '@buhuchet/adapters/password';
import { schema } from '@buhuchet/db';
import { createOrganization, type CreatedOrganization } from '@buhuchet/db/organizations';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from '@buhuchet/db/testing';
import { TELEGRAM_TEMPLATE_DEFAULTS, TEMP_PASSWORD_PATTERN } from '@buhuchet/domain';
import {
  ApiError,
  MeResponse,
  PasswordResetSentResponse,
  TemporaryPasswordResponse,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import { createTestDeps, linkTelegram, signIn, TEST_ORIGIN as ORIGIN } from '../../testing';

const { auditLog, employees, organizations, passwordResetCodes, users } = schema;

const PASSWORD = 'Верный-пароль-1';
const NEW_PASSWORD = 'Новый-пароль-2';
type App = ReturnType<typeof createApp>;

const json = (body: unknown, cookie?: string) => ({
  method: 'POST',
  headers: {
    origin: ORIGIN,
    'content-type': 'application/json',
    ...(cookie ? { cookie } : {}),
  },
  body: JSON.stringify(body),
});

async function error(res: Response) {
  return ApiError.parse(await res.json()).error;
}

const passedChangeNotice = (login: string) =>
  TELEGRAM_TEMPLATE_DEFAULTS.tgPassChanged.replace('{логин}', login);

describe.skipIf(!databaseAvailable())('«Забыли пароль?» и сброс временным паролем', () => {
  let t: TestDatabase;
  let tg: FakeTelegram;
  let deps: ApiDeps;
  let app: App;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId: string;
  const people: Record<string, { userId: string; employeeId: string }> = {};

  const requestCode = (login: string) => app.request('/api/auth/password-reset', json({ login }));
  const confirm = (login: string, code: string, newPassword = NEW_PASSWORD) =>
    app.request('/api/auth/password-reset/confirm', json({ login, code, newPassword }));
  /** Код из последнего сообщения бота. */
  const sentCode = () => /(\d{6})/.exec(tg.sent.at(-1)!.text)![1]!;
  const loginStatus = async (login: string, password: string) =>
    (await app.request('/api/auth/login', json({ login, password }))).status;
  const setPassword = async (userId: string, password = PASSWORD) =>
    t.admin.db
      .update(users)
      .set({ passwordHash: await hashPassword(password), mustChangePassword: false })
      .where(eq(users.id, userId));
  /** Окно «3 кода в час» прошло. */
  const forgetCodes = (userId: string) =>
    t.admin.db
      .update(passwordResetCodes)
      .set({ createdAt: new Date(Date.now() - 2 * 3_600_000) })
      .where(eq(passwordResetCodes.userId, userId));

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedAccessReference(t.admin.db);
    const passwordHash = await hashPassword(PASSWORD);
    const [admin] = await t.admin.db
      .insert(users)
      .values({ login: 'platform-admin', passwordHash, isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    const org = (name: string, inn: string, slug: string, owner: string) =>
      createOrganization(t.app.db, {
        name,
        inn,
        slug,
        owner: { fullName: `Владелец ${owner}`, login: owner, passwordHash },
      });
    a = await org('Организация А', '01811201810456', 'org-a', 'owner-a');
    b = await org('Организация Б', '02811201810457', 'org-b', 'owner-b');
    await t.admin.db.update(users).set({ mustChangePassword: false });
    for (const [login, org, template] of [
      ['acc-a', a, 'acc'],
      ['chief-a', a, 'chief'],
      ['lost-a', a, 'acc'],
      ['acc-b', b, 'acc'],
    ] as const) {
      const [u] = await t.admin.db
        .insert(users)
        .values({ orgId: org.orgId, login, passwordHash })
        .returning({ id: users.id });
      const [e] = await t.admin.db
        .insert(employees)
        .values({
          orgId: org.orgId,
          userId: u!.id,
          fullName: `Сотрудник ${login}`,
          shortName: login,
          roleId: org.roles.find((r) => r.templateCode === template)!.id,
        })
        .returning({ id: employees.id });
      people[login] = { userId: u!.id, employeeId: e!.id };
    }
    // Telegram привязан у acc-a (общий чат с acc-b из другой организации) и у владельца А.
    tg = createFakeTelegram();
    app = createApp(createTestDeps({ db: t.app.db, telegram: tg }));
    await linkTelegram(app, await signIn(app, 'acc-a', PASSWORD), 5001, 'alisher_t');
    await linkTelegram(app, await signIn(app, 'owner-a', PASSWORD), 5002, 'erkin_s');
  });

  beforeEach(() => {
    tg = createFakeTelegram();
    deps = createTestDeps({ db: t.app.db, telegram: tg });
    app = createApp(deps);
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('нет такого логина; без Telegram — кто сбросит пароль (прототип core/login.js)', async () => {
    const unknown = await requestCode('nobody');
    expect(unknown.status).toBe(404);
    expect(await error(unknown)).toMatchObject({
      code: 'unknown_login',
      message: 'Нет такого логина',
    });

    const employee = await requestCode('lost-a');
    expect(employee.status).toBe(409);
    expect(await error(employee)).toEqual({
      code: 'telegram_not_linked',
      message: 'Telegram не привязан. Пароль сбросит владелец организации.',
    });
    for (const login of ['owner-b', 'platform-admin']) {
      expect(await error(await requestCode(login))).toEqual({
        code: 'telegram_not_linked',
        message: 'Telegram не привязан. Пароль сбросит администратор платформы.',
      });
    }
    expect(tg.sent).toEqual([]);
  });

  it('код приходит в Telegram сразу, новый пароль закрывает прежние сеансы, бот сообщает о смене', async () => {
    const oldCookie = await signIn(app, 'owner-a', PASSWORD);
    const before = Date.now();
    const res = await requestCode('Owner-A ');
    expect(res.status).toBe(200);
    const body = PasswordResetSentResponse.parse(await res.json());
    expect(body.telegram).toBe('@erkin_s');
    const minutes = (Date.parse(body.expiresAt) - before) / 60_000;
    expect(minutes).toBeGreaterThan(9.9);
    expect(minutes).toBeLessThan(10.1);
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]).toMatchObject({ chatId: 5002 });
    const code = sentCode();
    expect(tg.sent[0]!.text).toBe(TELEGRAM_TEMPLATE_DEFAULTS.tgCode.replace('{код}', code));
    // Код в базе — только хешем.
    const rows = await t.admin.db
      .select()
      .from(passwordResetCodes)
      .where(eq(passwordResetCodes.userId, a.ownerUserId));
    expect(rows.every((r) => !r.codeHash.includes(code))).toBe(true);

    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await confirm('owner-a', wrong);
    expect(bad.status).toBe(400);
    expect(await error(bad)).toEqual({
      code: 'reset_code_invalid',
      message: 'Код неверный или истёк',
    });
    const done = await confirm('owner-a', code);
    expect(done.status).toBe(200);
    expect((await app.request('/api/auth/me', { headers: { cookie: oldCookie } })).status).toBe(
      401,
    );
    expect(await loginStatus('owner-a', PASSWORD)).toBe(401);
    expect(await loginStatus('owner-a', NEW_PASSWORD)).toBe(200);
    expect(tg.sent.at(-1)).toMatchObject({ chatId: 5002, text: passedChangeNotice('owner-a') });
    // Код одноразовый.
    expect((await confirm('owner-a', code, 'Третий-пароль-3')).status).toBe(400);
    const history = await t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, a.ownerUserId)));
    expect(history.at(-1)).toMatchObject({
      actorUserId: a.ownerUserId,
      changes: [{ field: 'passwordHash' }],
      reason: 'Восстановление пароля кодом из Telegram',
    });
    await setPassword(a.ownerUserId);
  });

  it('четвёртый запрос кода за час отклоняется; действует только последний код', async () => {
    await forgetCodes(people['acc-a']!.userId);
    const codes: string[] = [];
    for (let i = 0; i < 3; i++) {
      expect((await requestCode('acc-a')).status).toBe(200);
      codes.push(sentCode());
    }
    const fourth = await requestCode('acc-a');
    expect(fourth.status).toBe(429);
    expect(fourth.headers.get('retry-after')).toMatch(/^\d+$/);
    const err = await error(fourth);
    expect(err.code).toBe('reset_limited');
    expect(err.message).toMatch(
      /^Код уже запрашивали 3 раза за час\. Запросите новый после \d\d:\d\d\.$/,
    );
    expect(tg.sent).toHaveLength(3);
    // Один Telegram у двух организаций — в сообщении указана организация.
    await linkTelegram(app, await signIn(app, 'acc-b', PASSWORD), 5001);
    await forgetCodes(people['acc-a']!.userId);
    await requestCode('acc-a');
    expect(tg.sent.at(-1)!.text).toMatch(/^Организация А\nКод для восстановления пароля: \d{6}\./);
    const last = sentCode();
    if (codes[0] !== last) expect((await confirm('acc-a', codes[0]!)).status).toBe(400);
    expect((await confirm('acc-a', last)).status).toBe(200);
    await setPassword(people['acc-a']!.userId);
  });

  it('код через 10 минут не принимается', async () => {
    await forgetCodes(people['acc-a']!.userId);
    await requestCode('acc-a');
    const code = sentCode();
    await t.admin.db
      .update(passwordResetCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passwordResetCodes.userId, people['acc-a']!.userId));
    expect((await confirm('acc-a', code)).status).toBe(400);
    expect(await loginStatus('acc-a', PASSWORD)).toBe(200);
  });

  it('после 5 неверных вводов код не действует, даже верный', async () => {
    await forgetCodes(people['acc-a']!.userId);
    await requestCode('acc-a');
    const code = sentCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await confirm('acc-a', wrong)).status).toBe(400);
    expect((await confirm('acc-a', code)).status).toBe(400);
    expect((await confirm('nobody', code)).status).toBe(400);
    expect(await loginStatus('acc-a', PASSWORD)).toBe(200);
  });

  it('новый пароль по коду снимает блокировку входа после неверных паролей', async () => {
    for (let i = 0; i < 5; i++) await loginStatus('acc-a', 'неверный-пароль');
    expect(await loginStatus('acc-a', PASSWORD)).toBe(429);
    await forgetCodes(people['acc-a']!.userId);
    await requestCode('acc-a');
    expect((await confirm('acc-a', sentCode())).status).toBe(200);
    expect(await loginStatus('acc-a', NEW_PASSWORD)).toBe(200);
    await setPassword(people['acc-a']!.userId);
  });

  it('Telegram не принял сообщение — 502; бот не подключён — 503; заблокированному — 403', async () => {
    await forgetCodes(people['acc-a']!.userId);
    tg.failNext({ ok: false, errorCode: 403, description: 'blocked', permanent: true });
    const failed = await requestCode('acc-a');
    expect(failed.status).toBe(502);
    expect((await error(failed)).code).toBe('telegram_send_failed');

    const noBot = createApp(createTestDeps({ db: t.app.db, telegram: null }));
    const res = await noBot.request('/api/auth/password-reset', json({ login: 'acc-a' }));
    expect(res.status).toBe(503);

    await t.admin.db
      .update(employees)
      .set({ active: false })
      .where(eq(employees.id, people['acc-a']!.employeeId));
    const blocked = await requestCode('acc-a');
    expect(blocked.status).toBe(403);
    expect((await error(blocked)).code).toBe('employee_blocked');
    expect((await confirm('acc-a', '123456')).status).toBe(403);
    await t.admin.db
      .update(employees)
      .set({ active: true })
      .where(eq(employees.id, people['acc-a']!.employeeId));
    await t.admin.db
      .update(organizations)
      .set({ status: 'blocked' })
      .where(eq(organizations.id, a.orgId));
    expect((await error(await requestCode('acc-a'))).code).toBe('org_blocked');
    await t.admin.db
      .update(organizations)
      .set({ status: 'active' })
      .where(eq(organizations.id, a.orgId));
  });

  it('неверные данные запроса — 400 без запроса к Telegram', async () => {
    for (const body of [{}, { login: '' }, { login: 'x'.repeat(65) }]) {
      expect((await app.request('/api/auth/password-reset', json(body))).status).toBe(400);
    }
    for (const body of [
      { login: 'acc-a', code: '12345', newPassword: NEW_PASSWORD },
      { login: 'acc-a', code: '12345a', newPassword: NEW_PASSWORD },
      { login: 'acc-a', code: '123456', newPassword: 'short' },
    ]) {
      expect((await app.request('/api/auth/password-reset/confirm', json(body))).status).toBe(400);
    }
    expect(tg.sent).toEqual([]);
  });

  it('смена своего пароля в профиле — бот тоже сообщает', async () => {
    const cookie = await signIn(app, 'acc-a', PASSWORD);
    const res = await app.request(
      '/api/auth/password',
      json({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, cookie),
    );
    expect(res.status).toBe(200);
    expect(tg.sent.at(-1)!.text).toBe(`Организация А\n${passedChangeNotice('acc-a')}`);
    await setPassword(people['acc-a']!.userId);
  });

  describe('сброс временным паролем', () => {
    const resetEmployee = (cookie: string, employeeId: string) =>
      app.request(`/api/staff/${employeeId}/password-reset`, json({}, cookie));
    const resetByAdmin = (cookie: string, userId: string) =>
      app.request(`/api/admin/users/${userId}/password-reset`, json({}, cookie));

    it('владелец сбрасывает пароль сотрудника: временный пароль, сеансы закрыты, при входе — сменить', async () => {
      const employeeCookie = await signIn(app, 'lost-a', PASSWORD);
      const owner = await signIn(app, 'owner-a', PASSWORD);
      const res = await resetEmployee(owner, people['lost-a']!.employeeId);
      expect(res.status).toBe(200);
      const body = TemporaryPasswordResponse.parse(await res.json());
      expect(body.temporaryPassword).toMatch(TEMP_PASSWORD_PATTERN);
      expect(body.telegramNotified).toBe(false);
      expect(
        (await app.request('/api/auth/me', { headers: { cookie: employeeCookie } })).status,
      ).toBe(401);
      expect(await loginStatus('lost-a', PASSWORD)).toBe(401);
      const cookie = await signIn(app, 'lost-a', body.temporaryPassword);
      const me = MeResponse.parse(
        await (await app.request('/api/auth/me', { headers: { cookie } })).json(),
      );
      expect(me.user.mustChangePassword).toBe(true);
      const history = await t.admin.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, people['lost-a']!.userId)));
      expect(history.at(-1)).toMatchObject({
        actorUserId: a.ownerUserId,
        changes: [{ field: 'passwordHash' }, { field: 'mustChangePassword', to: true }],
      });
      expect(JSON.stringify(history)).not.toContain(body.temporaryPassword);
      await setPassword(people['lost-a']!.userId);
    });

    it('у сотрудника привязан Telegram — бот сообщает о сбросе', async () => {
      const owner = await signIn(app, 'owner-a', PASSWORD);
      const res = await resetEmployee(owner, people['acc-a']!.employeeId);
      expect(TemporaryPasswordResponse.parse(await res.json()).telegramNotified).toBe(true);
      expect(tg.sent.at(-1)).toMatchObject({ chatId: 5001 });
      await setPassword(people['acc-a']!.userId);
    });

    it('без права «Сотрудники и роли» — 403; владельца — только администратор; чужого — 404', async () => {
      const chief = await signIn(app, 'chief-a', PASSWORD);
      expect((await resetEmployee(chief, people['acc-a']!.employeeId)).status).toBe(403);
      const owner = await signIn(app, 'owner-a', PASSWORD);
      const ownerReset = await resetEmployee(owner, a.ownerEmployeeId);
      expect(ownerReset.status).toBe(403);
      expect((await error(ownerReset)).code).toBe('owner_password_reset');
      expect((await resetEmployee(owner, people['acc-b']!.employeeId)).status).toBe(404);
      expect(await loginStatus('acc-b', PASSWORD)).toBe(200);
      const admin = await signIn(app, 'platform-admin', PASSWORD);
      expect((await resetEmployee(admin, people['acc-a']!.employeeId)).status).toBe(403);
      expect((await resetEmployee(owner, 'not-a-uuid')).status).toBe(400);
    });

    it('администратор платформы сбрасывает пароль владельца; запись в истории организации', async () => {
      const admin = await signIn(app, 'platform-admin', PASSWORD);
      const res = await resetByAdmin(admin, b.ownerUserId);
      expect(res.status).toBe(200);
      const body = TemporaryPasswordResponse.parse(await res.json());
      expect(body.temporaryPassword).toMatch(TEMP_PASSWORD_PATTERN);
      expect(await loginStatus('owner-b', body.temporaryPassword)).toBe(200);
      const history = await t.admin.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, b.ownerUserId)));
      expect(history.at(-1)).toMatchObject({
        orgId: b.orgId,
        actorUserId: adminId,
        reason: 'Пароль сброшен администратором платформы: выдан временный пароль',
      });
      await setPassword(b.ownerUserId);

      // Владелец с Telegram — бот сообщает, с организацией, если Telegram общий.
      const notified = await resetByAdmin(admin, a.ownerUserId);
      expect(TemporaryPasswordResponse.parse(await notified.json()).telegramNotified).toBe(true);
      expect(tg.sent.at(-1)).toMatchObject({ chatId: 5002, text: passedChangeNotice('owner-a') });
      await setPassword(a.ownerUserId);
    });

    it('сброс в Админке — только администратору; администратора и неизвестного — 404', async () => {
      const owner = await signIn(app, 'owner-a', PASSWORD);
      expect((await resetByAdmin(owner, people['acc-a']!.userId)).status).toBe(403);
      const admin = await signIn(app, 'platform-admin', PASSWORD);
      expect((await resetByAdmin(admin, adminId)).status).toBe(404);
      expect((await resetByAdmin(admin, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect(await loginStatus('platform-admin', PASSWORD)).toBe(200);
    });
  });
});
