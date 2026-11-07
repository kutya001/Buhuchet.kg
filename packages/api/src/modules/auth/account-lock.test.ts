import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import { ACCOUNT_LOCK_FAILURES, TELEGRAM_TEMPLATE_DEFAULTS } from '@buhuchet/domain';
import { ApiError, TemporaryPasswordResponse } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { apiRequest, createStaffFixture, signIn, TEST_ORIGIN, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const { auditLog, loginAttempts, telegramLinks, telegramOutbox, users } = schema;

// Блокировка входа после 10 неверных паролей подряд (docs/deviations.md п. О-11) и предел попыток
// входа с одного адреса (п. О-12).
describe.skipIf(!databaseAvailable())('вход закрыт после 10 неверных паролей подряд', () => {
  let f: Fixture;
  let owner: string;
  let admin: string;
  let adminId: string;

  const login = (name: string, password: string, headers: Record<string, string> = {}) =>
    f.app.request('/api/auth/login', {
      method: 'POST',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ login: name, password }),
    });
  const code = async (res: Response) => ApiError.parse(await res.json()).error;
  /** Неверные пароли подряд; 15-минутный предел по логину снимается между ними, как будто прошло время. */
  const wrong = async (name: string, times: number) => {
    for (let i = 0; i < times; i++) {
      await f.t.admin.db.delete(loginAttempts).where(eq(loginAttempts.login, name));
      const res = await login(name, `неверный-${i}`);
      expect(res.status).toBe(401);
      expect((await code(res)).code).toBe('invalid_credentials');
    }
    await f.t.admin.db.delete(loginAttempts).where(eq(loginAttempts.login, name));
  };
  const userRow = async (name: string) =>
    (await f.t.admin.db.select().from(users).where(eq(users.login, name)))[0]!;
  const outboxOf = (userId: string) =>
    f.t.admin.db
      .select({ text: telegramOutbox.text, orgId: telegramOutbox.orgId })
      .from(telegramOutbox)
      .where(and(eq(telegramOutbox.userId, userId), eq(telegramOutbox.kind, 'login_locked')));

  beforeAll(async () => {
    f = await createStaffFixture();
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    adminId = (await userRow('platform-admin')).id;
    await f.t.admin.db.insert(telegramLinks).values([
      { userId: f.a.ownerUserId, orgId: f.a.orgId, chatId: 7001, username: 'owner_a' },
      { userId: f.people['acc-a']!.userId, orgId: f.a.orgId, chatId: 7002, username: 'acc_a' },
      { userId: adminId, orgId: null, chatId: 7003, username: 'platform' },
    ]);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('сотрудник: на десятом неверном пароле вход закрыт; узнать это можно только с верным паролем', async () => {
    await wrong('acc-a', ACCOUNT_LOCK_FAILURES - 1);
    expect((await login('acc-a', TEST_PASSWORD)).status).toBe(200);
    // Верный пароль снял счёт: снова десять попыток.
    expect((await userRow('acc-a')).loginFailures).toBe(0);

    await wrong('acc-a', ACCOUNT_LOCK_FAILURES);
    const row = await userRow('acc-a');
    expect(row.loginLockedAt).not.toBeNull();
    // Неверный пароль после блокировки — тот же ответ, что всегда: по нему блокировку не увидеть.
    await wrong('acc-a', 1);
    const locked = await login('acc-a', TEST_PASSWORD);
    expect(locked.status).toBe(403);
    const error = await code(locked);
    expect(error).toMatchObject({
      code: 'account_locked',
      message:
        'Вход заблокирован: 10 неверных паролей подряд. Обратитесь к владельцу организации — он выдаст новый пароль.',
      details: { failures: 10 },
    });

    // Пользователю и владельцу — сообщения в очередь Telegram; в истории — от имени системы.
    const toUser = await outboxOf(f.people['acc-a']!.userId);
    expect(toUser.map((m) => m.text)).toEqual([
      TELEGRAM_TEMPLATE_DEFAULTS.tgLoginLocked
        .replace('{логин}', 'acc-a')
        .replace('{попыток}', '10')
        .replace('{кто}', 'владелец организации'),
    ]);
    const toOwner = await outboxOf(f.a.ownerUserId);
    expect(toOwner.map((m) => m.text)).toEqual([
      TELEGRAM_TEMPLATE_DEFAULTS.tgLoginLockedStaff
        .replace('{логин}', 'acc-a')
        .replace('{попыток}', '10'),
    ]);
    expect(await outboxOf(adminId)).toEqual([]);
    const history = await f.t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, row.id), eq(auditLog.action, 'login_lock')));
    expect(history).toHaveLength(1);
    expect(history[0]!.actorUserId).toBeNull();
    expect(history[0]!.orgId).toBe(f.a.orgId);
  });

  it('код «Забыли пароль?», присланный до блокировки, после неё не подходит', async () => {
    // У старшего бухгалтера Telegram привязан к тому же чату, что у владельца: в сообщении — организация.
    await f.t.admin.db
      .insert(telegramLinks)
      .values({ userId: f.people['chief-a']!.userId, orgId: f.a.orgId, chatId: 7001 });
    expect(
      (
        await apiRequest(f.app, 'POST', '/api/auth/password-reset', undefined, {
          login: 'chief-a',
        })
      ).status,
    ).toBe(200);
    const sent = f.deps.telegram as unknown as { sent: { text: string }[] };
    const code = /(\d{6})/.exec(sent.sent.at(-1)!.text)![1]!;
    await wrong('chief-a', ACCOUNT_LOCK_FAILURES);
    const confirm = await apiRequest(f.app, 'POST', '/api/auth/password-reset/confirm', undefined, {
      login: 'chief-a',
      code,
      newPassword: 'Новый-пароль-1',
    });
    expect(confirm.status).toBe(400);
    expect((await userRow('chief-a')).loginLockedAt).not.toBeNull();
    const [toChief] = await outboxOf(f.people['chief-a']!.userId);
    expect(toChief!.text).toMatch(/^Организация А\n🔒 Вход в учётную запись chief-a/);
  });

  it('«Забыли пароль?» блокировку не снимает: код не уходит', async () => {
    const res = await apiRequest(f.app, 'POST', '/api/auth/password-reset', undefined, {
      login: 'acc-a',
    });
    expect(res.status).toBe(200);
    const codes = await f.t.admin.db
      .select()
      .from(telegramOutbox)
      .where(and(eq(telegramOutbox.chatId, 7002), eq(telegramOutbox.kind, 'code')));
    expect(codes).toEqual([]);
  });

  it('новый пароль от владельца снимает блокировку; в истории — «вход открыт»', async () => {
    const res = await apiRequest(
      f.app,
      'POST',
      `/api/staff/${f.people['acc-a']!.employeeId}/password-reset`,
      owner,
    );
    expect(res.status).toBe(200);
    const { temporaryPassword } = TemporaryPasswordResponse.parse(await res.json());
    const row = await userRow('acc-a');
    expect(row.loginLockedAt).toBeNull();
    expect(row.loginFailures).toBe(0);
    expect((await login('acc-a', temporaryPassword)).status).toBe(200);
    const [reset] = await f.t.admin.db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, row.id), eq(auditLog.action, 'update')));
    expect(reset!.changes).toContainEqual({ field: 'loginLocked', from: true, to: false });
  });

  it('владелец: блокировку снимает администратор платформы, сообщение — администраторам', async () => {
    await wrong('owner-a', ACCOUNT_LOCK_FAILURES);
    const locked = await login('owner-a', TEST_PASSWORD);
    expect(locked.status).toBe(403);
    expect(await code(locked)).toMatchObject({
      code: 'account_locked',
      message:
        'Вход заблокирован: 10 неверных паролей подряд. Обратитесь к администратору платформы — он выдаст новый пароль.',
      details: { variant: 'owner', failures: 10 },
    });
    const toAdmin = await outboxOf(adminId);
    expect(toAdmin).toEqual([
      {
        orgId: null,
        text: TELEGRAM_TEMPLATE_DEFAULTS.tgLoginLockedOwner
          .replace('{организация}', 'Организация А')
          .replace('{логин}', 'owner-a')
          .replace('{попыток}', '10'),
      },
    ]);
    // Открытый сеанс владельца блокировка не закрывает: она против подбора пароля.
    expect((await apiRequest(f.app, 'GET', '/api/auth/me', owner)).status).toBe(200);

    const res = await apiRequest(
      f.app,
      'POST',
      `/api/admin/users/${f.a.ownerUserId}/password-reset`,
      admin,
    );
    expect(res.status).toBe(200);
    const { temporaryPassword } = TemporaryPasswordResponse.parse(await res.json());
    expect((await login('owner-a', temporaryPassword)).status).toBe(200);
  });

  it('у администратора платформы блокировки нет — снять её было бы некому', async () => {
    await wrong('platform-admin', ACCOUNT_LOCK_FAILURES + 1);
    expect((await userRow('platform-admin')).loginLockedAt).toBeNull();
    expect((await login('platform-admin', TEST_PASSWORD)).status).toBe(200);
  });

  it('предел с одного адреса: сверх него — 429 для любого логина, другой адрес входит', async () => {
    const app = createApp({
      ...f.deps,
      authIpLimit: { kind: 'auth_ip', max: 3, windowSeconds: 600 },
    });
    const from = (ip: string, name: string, password: string) =>
      app.request('/api/auth/login', {
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          'content-type': 'application/json',
          'x-forwarded-for': `${ip}, 10.0.0.1`,
        },
        body: JSON.stringify({ login: name, password }),
      });
    expect((await from('203.0.113.7', 'acc-b', TEST_PASSWORD)).status).toBe(200);
    expect((await from('203.0.113.7', 'нет-такого', 'x'.repeat(8))).status).toBe(401);
    expect((await from('203.0.113.7', 'senior-a', TEST_PASSWORD)).status).toBe(200);
    const limited = await from('203.0.113.7', 'hr-a', TEST_PASSWORD);
    expect(limited.status).toBe(429);
    expect(await code(limited)).toMatchObject({
      code: 'auth_ip_limited',
      details: { minutes: 10 },
    });
    expect(limited.headers.get('retry-after')).toBe('600');
    // Восстановление пароля с того же адреса — в том же счёте.
    const reset = await app.request('/api/auth/password-reset', {
      method: 'POST',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.7',
      },
      body: JSON.stringify({ login: 'hr-a' }),
    });
    expect(reset.status).toBe(429);
    expect((await from('198.51.100.9', 'hr-a', TEST_PASSWORD)).status).toBe(200);
  });
});
