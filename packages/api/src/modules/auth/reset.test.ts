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
  PasswordResetRequestedResponse,
  TemporaryPasswordResponse,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import { createTestDeps, linkTelegram, signIn, TEST_ORIGIN as ORIGIN } from '../../testing';
import { RESET_REQUESTED_MESSAGE } from './reset';

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
const passwordResetNotice = (login: string, by: string) =>
  TELEGRAM_TEMPLATE_DEFAULTS.tgPassReset.replace('{логин}', login).replace('{кто}', by);

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

  /** Ответ шага 1 — один для любого логина (docs/deviations.md, п. 4, решение Б). */
  const expectRequested = async (res: Response) => {
    expect(res.status).toBe(200);
    expect(PasswordResetRequestedResponse.parse(await res.json())).toEqual({
      message: RESET_REQUESTED_MESSAGE,
    });
  };

  it('для любого логина один ответ: кто сбросит пароль без Telegram; код — только в привязанный', async () => {
    expect(RESET_REQUESTED_MESSAGE).toContain('пароль сбросит владелец организации');
    for (const login of ['nobody', 'lost-a', 'owner-b', 'platform-admin']) {
      await expectRequested(await requestCode(login));
    }
    expect(tg.sent).toEqual([]);
  });

  it('по времени ответа не видно, есть ли логин: оба шага не быстрее заданного порога', async () => {
    const slow = createApp(
      createTestDeps({ db: t.app.db, telegram: tg, resetResponseFloorMs: 300 }),
    );
    for (const [path, body] of [
      ['/api/auth/password-reset', { login: 'nobody' }],
      [
        '/api/auth/password-reset/confirm',
        { login: 'nobody', code: '123456', newPassword: NEW_PASSWORD },
      ],
    ] as const) {
      const started = Date.now();
      await slow.request(path, json(body));
      expect(Date.now() - started).toBeGreaterThanOrEqual(290);
    }
  });

  it('код приходит в Telegram сразу, новый пароль закрывает прежние сеансы, бот сообщает о смене', async () => {
    const oldCookie = await signIn(app, 'owner-a', PASSWORD);
    const before = Date.now();
    await expectRequested(await requestCode('Owner-A '));
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]).toMatchObject({ chatId: 5002 });
    const code = sentCode();
    expect(tg.sent[0]!.text).toBe(TELEGRAM_TEMPLATE_DEFAULTS.tgCode.replace('{код}', code));
    // Код в базе — только хешем; действует 10 минут.
    const rows = await t.admin.db
      .select()
      .from(passwordResetCodes)
      .where(eq(passwordResetCodes.userId, a.ownerUserId));
    expect(rows.every((r) => !r.codeHash.includes(code))).toBe(true);
    const minutes = (rows.at(-1)!.expiresAt.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(9.9);
    expect(minutes).toBeLessThan(10.1);

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

  it('четвёртый запрос кода за час отклоняется: код не приходит; действует только последний', async () => {
    await forgetCodes(people['acc-a']!.userId);
    const codes: string[] = [];
    for (let i = 0; i < 3; i++) {
      await expectRequested(await requestCode('acc-a'));
      codes.push(sentCode());
    }
    // Ответ тот же, что всегда (решение Б по п. 4), но четвёртого кода нет.
    await expectRequested(await requestCode('acc-a'));
    expect(tg.sent).toHaveLength(3);
    expect(
      await t.admin.db
        .select()
        .from(passwordResetCodes)
        .where(eq(passwordResetCodes.userId, people['acc-a']!.userId)),
    ).toHaveLength(3);
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

  it('Telegram не принял сообщение — тот же ответ; бот не подключён — 503; заблокированному — без кода', async () => {
    const userId = people['acc-a']!.userId;
    const codeCount = async () =>
      (
        await t.admin.db
          .select()
          .from(passwordResetCodes)
          .where(eq(passwordResetCodes.userId, userId))
      ).length;
    await forgetCodes(userId);
    const before = await codeCount();
    tg.failNext({ ok: false, errorCode: 403, description: 'blocked', permanent: true });
    await expectRequested(await requestCode('acc-a'));
    expect(tg.sent).toEqual([]);
    expect(await codeCount()).toBe(before + 1);

    const noBot = createApp(createTestDeps({ db: t.app.db, telegram: null }));
    for (const login of ['acc-a', 'nobody']) {
      const res = await noBot.request('/api/auth/password-reset', json({ login }));
      expect(res.status).toBe(503);
      expect((await error(res)).code).toBe('telegram_unavailable');
    }

    await t.admin.db
      .update(employees)
      .set({ active: false })
      .where(eq(employees.id, people['acc-a']!.employeeId));
    await forgetCodes(userId);
    await expectRequested(await requestCode('acc-a'));
    expect(await error(await confirm('acc-a', '123456'))).toMatchObject({
      code: 'reset_code_invalid',
    });
    await t.admin.db
      .update(employees)
      .set({ active: true })
      .where(eq(employees.id, people['acc-a']!.employeeId));
    await t.admin.db
      .update(organizations)
      .set({ status: 'blocked' })
      .where(eq(organizations.id, a.orgId));
    await expectRequested(await requestCode('acc-a'));
    await t.admin.db
      .update(organizations)
      .set({ status: 'active' })
      .where(eq(organizations.id, a.orgId));
    // Заблокированному код не записан и не отправлен.
    expect(tg.sent).toEqual([]);
    expect(await codeCount()).toBe(before + 1);
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

  it('смена своего пароля в профиле — бот тоже сообщает, ожидающий код отменяется', async () => {
    await forgetCodes(people['acc-a']!.userId);
    await requestCode('acc-a');
    const code = sentCode();
    const cookie = await signIn(app, 'acc-a', PASSWORD);
    const res = await app.request(
      '/api/auth/password',
      json({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, cookie),
    );
    expect(res.status).toBe(200);
    expect(tg.sent.at(-1)!.text).toBe(`Организация А\n${passedChangeNotice('acc-a')}`);
    expect((await confirm('acc-a', code, 'Третий-пароль-3')).status).toBe(400);
    expect(await loginStatus('acc-a', NEW_PASSWORD)).toBe(200);
    await setPassword(people['acc-a']!.userId);
  });

  it('10 неверных кодов за 24 часа — восстановление через Telegram закрыто на 24 часа', async () => {
    const userId = people['acc-a']!.userId;
    await forgetCodes(userId);
    await t.admin.db
      .update(passwordResetCodes)
      .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(passwordResetCodes.userId, userId));
    for (let round = 0; round < 2; round++) {
      await requestCode('acc-a');
      const wrong = sentCode() === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) expect((await confirm('acc-a', wrong)).status).toBe(400);
    }
    const sent = tg.sent.length;
    await expectRequested(await requestCode('acc-a'));
    expect(tg.sent).toHaveLength(sent);
    await t.admin.db.delete(passwordResetCodes).where(eq(passwordResetCodes.userId, userId));
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
        changes: [
          { field: 'passwordHash' },
          { field: 'mustChangePassword', from: false, to: true },
        ],
      });
      expect(JSON.stringify(history)).not.toContain(body.temporaryPassword);
      await setPassword(people['lost-a']!.userId);
    });

    it('у сотрудника привязан Telegram — бот сообщает, кто сбросил; ожидающий код отменяется', async () => {
      await forgetCodes(people['acc-a']!.userId);
      await requestCode('acc-a');
      const code = sentCode();
      const owner = await signIn(app, 'owner-a', PASSWORD);
      const res = await resetEmployee(owner, people['acc-a']!.employeeId);
      expect(TemporaryPasswordResponse.parse(await res.json()).telegramNotified).toBe(true);
      expect(tg.sent.at(-1)).toMatchObject({
        chatId: 5001,
        text: `Организация А\n${passwordResetNotice('acc-a', 'Владелец owner-a')}`,
      });
      expect((await confirm('acc-a', code)).status).toBe(400);
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
      expect(tg.sent.at(-1)).toMatchObject({
        chatId: 5002,
        text: passwordResetNotice('owner-a', 'администратор платформы'),
      });
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
