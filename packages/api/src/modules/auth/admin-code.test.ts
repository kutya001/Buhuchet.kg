import type { FakeTelegram } from '@buhuchet/adapters';
import {
  hashPassword,
  inPasswordQueue,
  PASSWORD_CONCURRENCY,
  PASSWORD_QUEUE_MAX,
} from '@buhuchet/adapters/password';
import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  ADMIN_CODE_MAX_ATTEMPTS,
  ADMIN_CODE_MAX_CODES,
  ADMIN_CODE_MAX_DAILY,
  ADMIN_CODE_TTL_MINUTES,
  TELEGRAM_TEMPLATE_DEFAULTS,
} from '@buhuchet/domain';
import {
  AdminCodeRequiredResponse,
  AdminTemporaryPasswordResponse,
  ApiError,
  MeResponse,
} from '@buhuchet/shared';
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import {
  apiRequest,
  cookieOf,
  createStaffFixture,
  sendToBot,
  signIn,
  telegramUpdate,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../../testing';
import { adminSecondFactorOn } from './admin-code';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type App = ReturnType<typeof createApp>;

const { adminLoginCodes, employees, telegramLinks, users } = schema;

// Код из Telegram при входе администратора платформы (ревью безопасности 06.11.2026, п. Р-2;
// docs/deviations.md п. О-13).
describe.skipIf(!databaseAvailable())('вход администратора платформы с кодом из Telegram', () => {
  let f: Fixture;
  let app: App;
  let tg: FakeTelegram;
  let adminId: string;
  const ADMIN_CHAT = 8001;

  const post = (target: App, path: string, body: unknown) =>
    target.request(path, {
      method: 'POST',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const login = (target: App = app, name = 'platform-admin', password = TEST_PASSWORD) =>
    post(target, '/api/auth/login', { login: name, password });
  const enterCode = (challenge: string, code: string) =>
    post(app, '/api/auth/login/code', { challenge, code });
  const error = async (res: Response) => ApiError.parse(await res.json()).error;
  /** Пароль верный: токен шага и код из последнего сообщения бота. */
  const passwordStep = async () => {
    const res = await login();
    expect(res.status).toBe(202);
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/bh_session=/);
    const { challenge } = AdminCodeRequiredResponse.parse(await res.json());
    const last = tg.sent.at(-1)!;
    expect(last.chatId).toBe(ADMIN_CHAT);
    return { challenge, code: /^(\d{6}) — код/m.exec(last.text)![1]! };
  };
  const otherCode = (code: string) => (code === '000000' ? '111111' : '000000');
  /** Сколько вводов занято у последнего кода. */
  const lastAttempts = async () =>
    (
      await f.t.admin.db
        .select({ attempts: adminLoginCodes.attempts })
        .from(adminLoginCodes)
        .where(eq(adminLoginCodes.userId, adminId))
        .orderBy(desc(adminLoginCodes.createdAt))
        .limit(1)
    )[0]!.attempts;

  beforeAll(async () => {
    f = await createStaffFixture();
    tg = f.deps.telegram as FakeTelegram;
    app = createApp({ ...f.deps, adminSecondFactor: true });
    adminId = (await f.t.admin.db.select().from(users).where(eq(users.login, 'platform-admin')))[0]!
      .id;
    await f.t.admin.db
      .insert(telegramLinks)
      .values({ userId: adminId, orgId: null, chatId: ADMIN_CHAT });
  });

  beforeEach(async () => {
    // Предел «3 кода за 15 минут» — свой у каждого теста.
    await f.t.admin.db.delete(adminLoginCodes);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('пароль верный — сеанса ещё нет, бот присылает код; неверный код — 400, верный — вход', async () => {
    const { challenge, code } = await passwordStep();
    expect(tg.sent.at(-1)!.text).toBe(
      TELEGRAM_TEMPLATE_DEFAULTS.tgAdminCode
        .replace('{логин}', 'platform-admin')
        .replace('{код}', code)
        .replace('{минут}', String(ADMIN_CODE_TTL_MINUTES)),
    );
    const wrong = await enterCode(challenge, otherCode(code));
    expect(wrong.status).toBe(400);
    expect(await error(wrong)).toMatchObject({ code: 'admin_code_invalid' });

    const ok = await enterCode(challenge, code);
    expect(ok.status).toBe(200);
    expect(MeResponse.parse(await ok.json()).user).toMatchObject({ isPlatformAdmin: true });
    const cookie = cookieOf(ok);
    expect((await apiRequest(app, 'GET', '/api/admin/health', cookie)).status).toBe(200);
    // Код одноразовый.
    expect((await enterCode(challenge, code)).status).toBe(400);
    // В журнал отправок код не пишется.
    const logged = await f.t.admin.db
      .select({ text: schema.telegramOutbox.text })
      .from(schema.telegramOutbox)
      .where(eq(schema.telegramOutbox.userId, adminId));
    expect(logged.map((r) => r.text).join('\n')).not.toContain(code);
  });

  it(`после ${ADMIN_CODE_MAX_ATTEMPTS} неверных вводов код не действует, даже верный; новый вход отменяет прежний код`, async () => {
    const first = await passwordStep();
    const second = await passwordStep();
    expect((await enterCode(first.challenge, first.code)).status).toBe(400);
    for (let i = 0; i < ADMIN_CODE_MAX_ATTEMPTS; i++) {
      expect((await enterCode(second.challenge, otherCode(second.code))).status).toBe(400);
    }
    expect((await enterCode(second.challenge, second.code)).status).toBe(400);
    // Чужой или выдуманный токен — тот же ответ.
    expect((await enterCode('A'.repeat(43), second.code)).status).toBe(400);
    expect((await enterCode('короткий', second.code)).status).toBe(400);
  });

  it(`не больше ${ADMIN_CODE_MAX_CODES} кодов за 15 минут — дальше 429`, async () => {
    for (let i = 0; i < ADMIN_CODE_MAX_CODES; i++) await passwordStep();
    const sent = tg.sent.length;
    const limited = await login();
    expect(limited.status).toBe(429);
    expect(await error(limited)).toMatchObject({
      code: 'admin_code_limited',
      details: { minutes: 15 },
    });
    expect(tg.sent).toHaveLength(sent);
  });

  it('неверный пароль — как у всех: «Неверный логин или пароль», кода нет', async () => {
    const sent = tg.sent.length;
    const res = await login(app, 'platform-admin', 'неверный-пароль');
    expect(res.status).toBe(401);
    expect(tg.sent).toHaveLength(sent);
    await f.t.admin.db.delete(schema.loginAttempts);
  });

  it('за время кода учётную запись заблокировали — код не подходит', async () => {
    const { challenge, code } = await passwordStep();
    await f.t.admin.db.update(users).set({ blocked: true }).where(eq(users.id, adminId));
    try {
      expect((await enterCode(challenge, code)).status).toBe(400);
    } finally {
      await f.t.admin.db.update(users).set({ blocked: false }).where(eq(users.id, adminId));
    }
  });

  it('пароль сменили после кода — код не подходит', async () => {
    const { challenge, code } = await passwordStep();
    const [row] = await f.t.admin.db
      .select({ hash: users.passwordHash })
      .from(users)
      .where(eq(users.id, adminId));
    await f.t.admin.db
      .update(users)
      .set({ passwordHash: await hashPassword(TEST_PASSWORD) })
      .where(eq(users.id, adminId));
    try {
      expect((await enterCode(challenge, code)).status).toBe(400);
    } finally {
      await f.t.admin.db
        .update(users)
        .set({ passwordHash: row!.hash })
        .where(eq(users.id, adminId));
    }
  });

  it(`за сутки не больше ${ADMIN_CODE_MAX_DAILY} кодов без входа — дальше 429 с советом сменить пароль`, async () => {
    const back = () =>
      f.t.admin.db
        .update(adminLoginCodes)
        .set({ createdAt: new Date(Date.now() - 3600_000) })
        .where(eq(adminLoginCodes.userId, adminId));
    for (let i = 0; i < ADMIN_CODE_MAX_DAILY; i++) {
      await passwordStep();
      await back();
    }
    const sent = tg.sent.length;
    const limited = await login();
    expect(limited.status).toBe(429);
    expect(await error(limited)).toMatchObject({
      code: 'admin_code_limited',
      details: { variant: 'day', max: ADMIN_CODE_MAX_DAILY },
    });
    expect(tg.sent).toHaveLength(sent);
  });

  it('очередь проверки паролей полна — 503 server_busy, ввод кода не тратится', async () => {
    const { challenge, code } = await passwordStep();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held = Array.from({ length: PASSWORD_CONCURRENCY + PASSWORD_QUEUE_MAX }, () =>
      inPasswordQueue(() => gate),
    );
    try {
      const busy = await enterCode(challenge, code);
      expect(busy.status).toBe(503);
      expect(await error(busy)).toMatchObject({ code: 'server_busy' });
    } finally {
      release();
      await Promise.all(held);
    }
    expect(await lastAttempts()).toBe(0);
    expect((await enterCode(challenge, code)).status).toBe(200);
  });

  it('ввод кода — в общем пределе попыток с одного адреса', async () => {
    const { challenge, code } = await passwordStep();
    const limitedApp = createApp({
      ...f.deps,
      adminSecondFactor: true,
      authIpLimit: { kind: 'auth_ip', max: 2, windowSeconds: 600 },
    });
    const from = (ip: string, body: unknown) =>
      limitedApp.request('/api/auth/login/code', {
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          'content-type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify(body),
      });
    expect((await from('203.0.113.9', { challenge, code: otherCode(code) })).status).toBe(400);
    expect((await from('203.0.113.9', { challenge, code: otherCode(code) })).status).toBe(400);
    const limited = await from('203.0.113.9', { challenge, code });
    expect(limited.status).toBe(429);
    expect(await error(limited)).toMatchObject({ code: 'auth_ip_limited' });
    // Сверх предела ввод не занимается: с другого адреса верный код подходит.
    expect(await lastAttempts()).toBe(2);
    expect((await from('203.0.113.10', { challenge, code })).status).toBe(200);
  });

  it('без привязанного Telegram — ссылка привязки вместо сеанса; после привязки — вход с кодом', async () => {
    await f.t.admin.db.delete(telegramLinks).where(eq(telegramLinks.userId, adminId));
    try {
      const res = await login();
      expect(res.status).toBe(403);
      expect(res.headers.get('set-cookie') ?? '').not.toMatch(/bh_session=/);
      const body = await error(res);
      expect(body.code).toBe('telegram_required');
      const { url } = body.details as { url: string };
      expect(url).toMatch(/^https:\/\/t\.me\/buhuchet_test_bot\?start=[A-Za-z0-9_-]{43}$/);
      const token = new URL(url).searchParams.get('start')!;
      expect((await sendToBot(app, telegramUpdate(`/start ${token}`, 8002))).status).toBe(200);
      const step = await login();
      expect(step.status).toBe(202);
      expect(tg.sent.at(-1)!.chatId).toBe(8002);
    } finally {
      await f.t.admin.db.delete(telegramLinks).where(eq(telegramLinks.userId, adminId));
      await f.t.admin.db
        .insert(telegramLinks)
        .values({ userId: adminId, orgId: null, chatId: ADMIN_CHAT });
    }
  });

  it('бот не подключён или не принял сообщение — 503, сеанса нет', async () => {
    const noBot = createApp({ ...f.deps, telegram: null, adminSecondFactor: true });
    const res = await login(noBot);
    expect(res.status).toBe(503);
    expect(await error(res)).toMatchObject({ code: 'telegram_unavailable' });

    tg.failNext({
      ok: false,
      errorCode: 403,
      description: 'Forbidden: bot was blocked by the user',
      permanent: true,
    });
    const failed = await login();
    expect(failed.status).toBe(503);
    expect(await error(failed)).toMatchObject({ code: 'telegram_send_failed' });
    expect(failed.headers.get('set-cookie') ?? '').not.toMatch(/bh_session=/);
  });

  it('сотрудники организаций входят как раньше — без кода', async () => {
    const res = await login(app, 'owner-a');
    expect(res.status).toBe(200);
    expect(cookieOf(res)).toMatch(/bh_session=/);
  });

  it('код нужен на стенде и рабочем сайте, на своём компьютере и в тестах — нет', () => {
    const on = (APP_ENV: string, adminSecondFactor?: boolean) =>
      adminSecondFactorOn({ config: { APP_ENV }, adminSecondFactor } as unknown as ApiDeps);
    expect(on('production')).toBe(true);
    expect(on('staging')).toBe(true);
    expect(on('local')).toBe(false);
    expect(on('test')).toBe(false);
    expect(on('test', true)).toBe(true);
  });

  it('администратор сбросил пароль сотрудника — владельцам сообщение и предпросмотр; пароль владельца — только ему', async () => {
    const admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    // Второй владелец организации А — без Telegram у него сообщения нет.
    const [second] = await f.t.admin.db
      .insert(users)
      .values({ orgId: f.a.orgId, login: 'owner-a2', passwordHash: 'x' })
      .returning({ id: users.id });
    await f.t.admin.db.insert(employees).values({
      orgId: f.a.orgId,
      userId: second!.id,
      fullName: 'Второй владелец',
      shortName: 'owner-a2',
      roleId: f.a.roles.find((r) => r.isOwner)!.id,
    });
    await f.t.admin.db.insert(telegramLinks).values([
      { userId: f.a.ownerUserId, orgId: f.a.orgId, chatId: 8101, username: 'erkin_s' },
      { userId: f.b.ownerUserId, orgId: f.b.orgId, chatId: 8102 },
    ]);
    const reset = async (userId: string) => {
      const res = await apiRequest(
        f.app,
        'POST',
        `/api/admin/users/${userId}/password-reset`,
        admin,
      );
      expect(res.status).toBe(200);
      return AdminTemporaryPasswordResponse.parse(await res.json());
    };
    const toOwner = () => tg.sent.filter((m) => m.chatId === 8101).map((m) => m.text);
    const notice = TELEGRAM_TEMPLATE_DEFAULTS.tgPassResetByAdmin.replace('{логин}', 'acc-a');

    // Окно «Пароль сброшен» показывает, кому и что бот прислал (прототип accResetPass).
    expect((await reset(f.people['acc-a']!.userId)).ownersNotice).toEqual({
      to: ['@erkin_s'],
      text: notice,
    });
    expect(toOwner()).toEqual([notice]);
    // Владелец другой организации ничего не получает.
    expect(tg.sent.filter((m) => m.chatId === 8102)).toEqual([]);

    // Второму владельцу привязали Telegram: сброс пароля первого владельца — только ему самому.
    await f.t.admin.db
      .insert(telegramLinks)
      .values({ userId: second!.id, orgId: f.a.orgId, chatId: 8103 });
    expect((await reset(f.a.ownerUserId)).ownersNotice).toBeNull();
    expect(toOwner()).toEqual([
      notice,
      TELEGRAM_TEMPLATE_DEFAULTS.tgPassReset
        .replace('{логин}', 'owner-a')
        .replace('{кто}', 'администратор платформы'),
    ]);
    expect(tg.sent.filter((m) => m.chatId === 8103)).toEqual([]);

    // Сброс пароля сотрудника — обоим владельцам; без имени пользователя — имя в Telegram.
    expect((await reset(f.people['chief-a']!.userId)).ownersNotice?.to.sort()).toEqual(
      ['@erkin_s', 'Telegram'].sort(),
    );
    expect(tg.sent.filter((m) => m.chatId === 8102)).toEqual([]);
  });
});
