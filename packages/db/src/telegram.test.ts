import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeOwnPassword, sessionByToken, startSession, withUserContext } from './auth';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import { getEmployee } from './staff';
import type { Tx } from './client';
import {
  employees,
  loginAttempts,
  passwordResetCodes,
  platformReference,
  sessions,
  telegramLinks,
  telegramLinkTokens,
  users,
} from './schema';
import {
  adminFindUser,
  completePasswordReset,
  createTelegramLinkToken,
  messageTemplates,
  passwordResetStatus,
  peekTelegramLink,
  requestPasswordReset,
  reservePasswordResetAttempt,
  setTemporaryPassword,
  telegramChat,
  unlinkTelegram,
  useTelegramLink,
} from './telegram';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const newHash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }),
});

describe.skipIf(!databaseAvailable())('Telegram и «Забыли пароль?» в базе', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId: string;
  let accA: string; // второй пользователь организации А (бухгалтер)
  let accAEmployee: string;

  const ctxA = () => ({ orgId: a.orgId, userId: a.ownerUserId });
  const linkAs = async (
    ctx: { orgId: string; userId: string } | { admin: string },
    chatId: number,
    username: string | null = null,
  ) => {
    const token = newHash();
    const run = <T>(fn: (tx: Tx) => Promise<T>) =>
      'admin' in ctx ? withUserContext(t.app.db, ctx.admin, fn) : withOrgContext(t.app.db, ctx, fn);
    await run((tx) => createTelegramLinkToken(tx, token));
    return run((tx) =>
      useTelegramLink(tx, { tokenHash: token, chatId, username, firstName: 'Имя' }),
    );
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedAccessReference(t.admin.db);
    const [admin] = await t.admin.db
      .insert(users)
      .values({ login: 'platform-admin', passwordHash: 'hash-admin', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    a = await createOrganization(t.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'org-a',
      owner: { fullName: 'Токтомаматов Бекзат', login: 'owner-a', passwordHash: 'hash-a' },
    });
    b = await createOrganization(t.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'org-b',
      owner: { fullName: 'Абдыкадырова Айгуль', login: 'owner-b', passwordHash: 'hash-b' },
    });
    const accRole = a.roles.find((r) => r.templateCode === 'acc')!;
    const [u] = await t.admin.db
      .insert(users)
      .values({ orgId: a.orgId, login: 'acc-a', passwordHash: 'hash-acc' })
      .returning({ id: users.id });
    accA = u!.id;
    const [e] = await t.admin.db
      .insert(employees)
      .values({
        orgId: a.orgId,
        userId: accA,
        fullName: 'Асанов Алишер',
        shortName: 'Асанов А.',
        roleId: accRole.id,
      })
      .returning({ id: employees.id });
    accAEmployee = e!.id;
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('ссылка привязки: одноразовая, 15 минут, у пользователя действует только последняя', async () => {
    const first = newHash();
    const second = newHash();
    const before = Date.now();
    const until = await withOrgContext(t.app.db, ctxA(), (tx) =>
      createTelegramLinkToken(tx, first),
    );
    const minutes = (until.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(14.9);
    expect(minutes).toBeLessThan(15.1);
    await withOrgContext(t.app.db, ctxA(), (tx) => createTelegramLinkToken(tx, second));
    expect(await peekTelegramLink(t.app.db, first)).toBeNull();
    expect(await peekTelegramLink(t.app.db, second)).toMatchObject({
      userId: a.ownerUserId,
      orgId: a.orgId,
      login: 'owner-a',
      orgName: 'Организация А',
      used: false,
      expired: false,
      linkedChatId: null,
      employeeActive: true,
      orgStatus: 'active',
    });

    // Ссылку использует только её владелец (из контекста) и только один раз.
    const foreign = await withOrgContext(t.app.db, { orgId: a.orgId, userId: accA }, (tx) =>
      useTelegramLink(tx, { tokenHash: second, chatId: 111, username: 'x', firstName: null }),
    );
    expect(foreign).toBeNull();
    const used = await withOrgContext(t.app.db, ctxA(), (tx) =>
      useTelegramLink(tx, {
        tokenHash: second,
        chatId: 5001,
        username: 'erkin_s',
        firstName: 'Эркин',
      }),
    );
    expect(used).toEqual({ previous: null, shared: false });
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) =>
        useTelegramLink(tx, { tokenHash: second, chatId: 5002, username: null, firstName: null }),
      ),
    ).toBeNull();
    expect(await peekTelegramLink(t.app.db, second)).toMatchObject({
      used: true,
      linkedChatId: 5001,
    });
    expect(await telegramChat(t.app.db, a.ownerUserId)).toMatchObject({
      chatId: 5001,
      username: 'erkin_s',
      firstName: 'Эркин',
      shared: false,
    });
  });

  it('истёкшая ссылка не действует; новая ссылка заменяет прежнюю привязку', async () => {
    const token = newHash();
    await withOrgContext(t.app.db, ctxA(), (tx) => createTelegramLinkToken(tx, token));
    await t.admin.db
      .update(telegramLinkTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(telegramLinkTokens.tokenHash, token));
    expect(await peekTelegramLink(t.app.db, token)).toMatchObject({ expired: true });
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) =>
        useTelegramLink(tx, { tokenHash: token, chatId: 1, username: null, firstName: null }),
      ),
    ).toBeNull();

    expect(await linkAs(ctxA(), 5003, 'erkin_new')).toEqual({
      previous: { chatId: 5001, username: 'erkin_s', firstName: 'Эркин', shared: false },
      shared: false,
    });
    expect(await telegramChat(t.app.db, a.ownerUserId)).toMatchObject({ chatId: 5003 });
  });

  it('один Telegram у нескольких логинов, в том числе в разных организациях и у администратора', async () => {
    expect(await linkAs({ orgId: b.orgId, userId: b.ownerUserId }, 5003)).toMatchObject({
      shared: true,
    });
    expect(await telegramChat(t.app.db, a.ownerUserId)).toMatchObject({ shared: true });
    expect(await linkAs({ admin: adminId }, 7001, 'admin')).toEqual({
      previous: null,
      shared: false,
    });
    expect(await telegramChat(t.app.db, adminId)).toMatchObject({ chatId: 7001 });
  });

  it('отвязать можно только свой Telegram', async () => {
    // Этот чат остаётся привязан к владельцу А — в сообщении об отвязке нужна организация.
    expect(
      await withOrgContext(t.app.db, { orgId: b.orgId, userId: b.ownerUserId }, unlinkTelegram),
    ).toEqual({ chatId: 5003, username: null, firstName: 'Имя', shared: true });
    expect(await telegramChat(t.app.db, b.ownerUserId)).toBeNull();
    expect(await telegramChat(t.app.db, a.ownerUserId)).toMatchObject({ shared: false });
    expect(
      await withOrgContext(t.app.db, { orgId: b.orgId, userId: b.ownerUserId }, unlinkTelegram),
    ).toBeNull();
    expect(await withUserContext(t.app.db, adminId, unlinkTelegram)).toEqual({
      chatId: 7001,
      username: 'admin',
      firstName: 'Имя',
      shared: false,
    });
  });

  it('чужая организация не видна: привязки, ссылки и коды Б из контекста А', async () => {
    await linkAs({ orgId: b.orgId, userId: b.ownerUserId }, 6001);
    await withOrgContext(t.app.db, { orgId: b.orgId, userId: b.ownerUserId }, (tx) =>
      createTelegramLinkToken(tx, newHash()),
    );
    await requestPasswordReset(t.app.db, { userId: b.ownerUserId, codeHash: 'code-b' });
    for (const table of [telegramLinks, telegramLinkTokens, passwordResetCodes]) {
      const seen = await withOrgContext(t.app.db, ctxA(), (tx) => tx.select().from(table));
      expect(seen.every((r) => r.orgId === a.orgId)).toBe(true);
      const seenB = await withOrgContext(t.app.db, { orgId: b.orgId }, (tx) =>
        tx.select().from(table),
      );
      expect(seenB.length).toBeGreaterThan(0);
      // Без контекста роль приложения не видит ничего.
      expect(await t.app.db.select().from(table)).toEqual([]);
    }
  });

  it('чужая организация не меняется и не создаётся: напрямую эти таблицы роль приложения не меняет', async () => {
    // Только функции app.telegram_* и app.auth_reset_*: ошибка в коде не перепривяжет чужой Telegram,
    // не обнулит попытки ввода кода и не подставит свой хеш — ни в чужой организации, ни в своей.
    const attempts = [
      (tx: Tx) =>
        tx.update(telegramLinks).set({ chatId: 1 }).where(eq(telegramLinks.userId, b.ownerUserId)),
      (tx: Tx) =>
        tx
          .update(passwordResetCodes)
          .set({ attempts: 0 })
          .where(eq(passwordResetCodes.userId, a.ownerUserId)),
      (tx: Tx) => tx.delete(passwordResetCodes).where(eq(passwordResetCodes.userId, b.ownerUserId)),
      (tx: Tx) => tx.delete(telegramLinkTokens).where(eq(telegramLinkTokens.userId, a.ownerUserId)),
      (tx: Tx) =>
        tx.insert(telegramLinks).values({ userId: b.ownerUserId, orgId: b.orgId, chatId: 2 }),
      (tx: Tx) =>
        tx.insert(passwordResetCodes).values({
          userId: a.ownerUserId,
          orgId: a.orgId,
          codeHash: 'x',
          expiresAt: new Date(Date.now() + 60_000),
        }),
    ];
    for (const attempt of attempts) {
      await expect(withOrgContext(t.app.db, ctxA(), attempt)).rejects.toThrow(permissionDenied);
    }
    expect(await telegramChat(t.app.db, b.ownerUserId)).toMatchObject({ chatId: 6001 });
  });

  it('код «Забыли пароль?»: без Telegram не записывается, 10 минут, не больше 3 в час', async () => {
    expect(await passwordResetStatus(t.app.db, accA)).toEqual({ status: 'no_telegram' });
    expect(await requestPasswordReset(t.app.db, { userId: accA, codeHash: 'c0' })).toEqual({
      status: 'no_telegram',
    });
    expect(await passwordResetStatus(t.app.db, '00000000-0000-4000-8000-000000000000')).toEqual({
      status: 'no_user',
    });
    expect(await passwordResetStatus(t.app.db, a.ownerUserId)).toEqual({ status: 'ok' });
    expect(
      await requestPasswordReset(t.app.db, {
        userId: '00000000-0000-4000-8000-000000000000',
        codeHash: 'c0',
      }),
    ).toEqual({ status: 'no_user' });

    const before = Date.now();
    const first = await requestPasswordReset(t.app.db, { userId: a.ownerUserId, codeHash: 'c1' });
    expect(first).toMatchObject({
      status: 'sent',
      chat: { chatId: 5003, username: 'erkin_new', shared: false },
    });
    const minutes = ((first as { expiresAt: Date }).expiresAt.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(9.9);
    expect(minutes).toBeLessThan(10.1);
    expect(
      await requestPasswordReset(t.app.db, { userId: a.ownerUserId, codeHash: 'c2' }),
    ).toMatchObject({ status: 'sent' });
    expect(
      await requestPasswordReset(t.app.db, { userId: a.ownerUserId, codeHash: 'c3' }),
    ).toMatchObject({ status: 'sent' });
    const fourth = await requestPasswordReset(t.app.db, { userId: a.ownerUserId, codeHash: 'c4' });
    expect(fourth.status).toBe('limited');
    const retry = (fourth as { retryAt: Date }).retryAt.getTime() - before;
    expect(retry / 60_000).toBeGreaterThan(59.9);
    expect(retry / 60_000).toBeLessThan(60.1);
    expect(await passwordResetStatus(t.app.db, a.ownerUserId)).toEqual(fourth);

    // Действует только последний код (c3).
    expect(await reservePasswordResetAttempt(t.app.db, a.ownerUserId)).toMatchObject({
      codeHash: 'c3',
    });
    const codes = await t.admin.db
      .select()
      .from(passwordResetCodes)
      .where(eq(passwordResetCodes.userId, a.ownerUserId));
    expect(codes).toHaveLength(3);
    expect(codes.filter((c) => c.expiresAt.getTime() > Date.now())).toHaveLength(1);
  });

  it('ввод кода: не больше 5 попыток, и одновременно тоже; потом код не действует', async () => {
    // Окно в час прошло: коды «старые».
    await t.admin.db
      .update(passwordResetCodes)
      .set({ createdAt: new Date(Date.now() - 2 * 3_600_000) })
      .where(eq(passwordResetCodes.userId, a.ownerUserId));
    await requestPasswordReset(t.app.db, { userId: a.ownerUserId, codeHash: 'race' });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reservePasswordResetAttempt(t.app.db, a.ownerUserId)),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await reservePasswordResetAttempt(t.app.db, a.ownerUserId)).toBeNull();
  });

  it('верный код: новый пароль, все сеансы завершены, блокировка входа снята; код — один раз', async () => {
    await t.admin.db
      .update(passwordResetCodes)
      .set({ createdAt: new Date(Date.now() - 2 * 3_600_000) })
      .where(eq(passwordResetCodes.userId, a.ownerUserId));
    await requestPasswordReset(t.app.db, { userId: a.ownerUserId, codeHash: 'good' });
    const token = newHash();
    await startSession(t.app.db, { userId: a.ownerUserId, tokenHash: token });
    await t.admin.db
      .insert(loginAttempts)
      .values({ login: 'owner-a', failures: 0, lockedUntil: new Date(Date.now() + 600_000) });
    const attempt = (await reservePasswordResetAttempt(t.app.db, a.ownerUserId))!;
    expect(attempt.codeHash).toBe('good');

    // Чужой пользователь в контексте код не использует.
    expect(
      await withOrgContext(t.app.db, { orgId: a.orgId, userId: accA }, (tx) =>
        completePasswordReset(tx, { resetId: attempt.resetId, passwordHash: 'evil' }),
      ),
    ).toBe(false);
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) =>
        completePasswordReset(tx, { resetId: attempt.resetId, passwordHash: 'new-hash' }),
      ),
    ).toBe(true);
    const [u] = await t.admin.db.select().from(users).where(eq(users.id, a.ownerUserId));
    expect(u).toMatchObject({ passwordHash: 'new-hash', mustChangePassword: false });
    expect(
      await t.admin.db.select().from(loginAttempts).where(eq(loginAttempts.login, 'owner-a')),
    ).toEqual([]);
    expect(await sessionByToken(t.app.db, token)).toBeNull();
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) =>
        completePasswordReset(tx, { resetId: attempt.resetId, passwordHash: 'again' }),
      ),
    ).toBe(false);
    expect(await reservePasswordResetAttempt(t.app.db, a.ownerUserId)).toBeNull();
  });

  it('за сутки не больше 10 неверных кодов: потом код не присылается и не принимается', async () => {
    // Прежние коды — старше суток.
    await t.admin.db
      .update(passwordResetCodes)
      .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(passwordResetCodes.userId, a.ownerUserId));
    expect(await passwordResetStatus(t.app.db, a.ownerUserId)).toEqual({ status: 'ok' });
    const wrong = async (codeHash: string, times: number) => {
      expect(
        await requestPasswordReset(t.app.db, { userId: a.ownerUserId, codeHash }),
      ).toMatchObject({ status: 'sent' });
      for (let i = 0; i < times; i++) {
        expect(await reservePasswordResetAttempt(t.app.db, a.ownerUserId)).not.toBeNull();
      }
    };
    await wrong('d1', 5);
    await wrong('d2', 4);
    // Третий код: у него самого попыток много, но за сутки это уже десятый неверный ввод.
    await wrong('d3', 1);
    expect(await reservePasswordResetAttempt(t.app.db, a.ownerUserId)).toBeNull();
    const locked = await passwordResetStatus(t.app.db, a.ownerUserId);
    expect(locked.status).toBe('locked');
    const hours = ((locked as { retryAt: Date }).retryAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
    expect(
      await requestPasswordReset(t.app.db, { userId: a.ownerUserId, codeHash: 'd4' }),
    ).toMatchObject({ status: 'locked' });
  });

  it('временный пароль от владельца: сменить при входе, сеансы завершены, вход открыт; чужого не сбросить', async () => {
    const token = newHash();
    await startSession(t.app.db, { userId: accA, tokenHash: token });
    await t.admin.db
      .insert(loginAttempts)
      .values({ login: 'acc-a', failures: 0, lockedUntil: new Date(Date.now() + 600_000) });
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) => getEmployee(tx, accAEmployee)),
    ).toMatchObject({
      userId: accA,
      login: 'acc-a',
      role: { isOwner: false },
      fullName: 'Асанов Алишер',
    });
    expect(
      await withOrgContext(t.app.db, { orgId: b.orgId }, (tx) => getEmployee(tx, accAEmployee)),
    ).toBeNull();
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) =>
        setTemporaryPassword(tx, { userId: accA, passwordHash: 'temp' }),
      ),
    ).toEqual({ mustChangePasswordBefore: false });
    const [u] = await t.admin.db.select().from(users).where(eq(users.id, accA));
    expect(u).toMatchObject({ passwordHash: 'temp', mustChangePassword: true });
    expect(await sessionByToken(t.app.db, token)).toBeNull();
    expect(
      await t.admin.db.select().from(loginAttempts).where(eq(loginAttempts.login, 'acc-a')),
    ).toEqual([]);

    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) =>
        setTemporaryPassword(tx, { userId: b.ownerUserId, passwordHash: 'evil' }),
      ),
    ).toBeNull();
    const [ub] = await t.admin.db.select().from(users).where(eq(users.id, b.ownerUserId));
    expect(ub!.passwordHash).toBe('hash-b');
    expect(
      await t.app.db.select().from(sessions).where(eq(sessions.userId, b.ownerUserId)),
    ).toEqual([]);
  });

  it('ожидающий код отменяется: смена и сброс пароля, отвязка и замена Telegram', async () => {
    const pendingAfter = async (userId: string, action: () => Promise<unknown>) => {
      await t.admin.db.delete(passwordResetCodes).where(eq(passwordResetCodes.userId, userId));
      expect(await requestPasswordReset(t.app.db, { userId, codeHash: 'pending' })).toMatchObject({
        status: 'sent',
      });
      await action();
      return (await reservePasswordResetAttempt(t.app.db, userId)) !== null;
    };
    const sessionId = await startSession(t.app.db, {
      userId: a.ownerUserId,
      tokenHash: newHash(),
    });
    expect(
      await pendingAfter(a.ownerUserId, () =>
        withOrgContext(t.app.db, ctxA(), (tx) =>
          changeOwnPassword(tx, { sessionId, passwordHash: 'own', newTokenHash: newHash() }),
        ),
      ),
    ).toBe(false);

    await linkAs({ orgId: a.orgId, userId: accA }, 5010);
    expect(
      await pendingAfter(accA, () =>
        withOrgContext(t.app.db, ctxA(), (tx) =>
          setTemporaryPassword(tx, { userId: accA, passwordHash: 'temp-2' }),
        ),
      ),
    ).toBe(false);

    expect(
      await pendingAfter(accA, () =>
        withOrgContext(t.app.db, { orgId: a.orgId, userId: accA }, unlinkTelegram),
      ),
    ).toBe(false);

    // Замена Telegram на другой чат отменяет код, повторная привязка того же чата — нет.
    await linkAs({ orgId: a.orgId, userId: accA }, 5011);
    expect(await pendingAfter(accA, () => linkAs({ orgId: a.orgId, userId: accA }, 5012))).toBe(
      false,
    );
    expect(await pendingAfter(accA, () => linkAs({ orgId: a.orgId, userId: accA }, 5012))).toBe(
      true,
    );
  });

  it('администратор платформы находит учётную запись; остальные — нет', async () => {
    expect(
      await withUserContext(t.app.db, adminId, (tx) => adminFindUser(tx, b.ownerUserId)),
    ).toEqual({ userId: b.ownerUserId, orgId: b.orgId, login: 'owner-b', isPlatformAdmin: false });
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) => adminFindUser(tx, b.ownerUserId)),
    ).toBeNull();
    await t.admin.db.update(users).set({ blocked: true }).where(eq(users.id, adminId));
    expect(
      await withUserContext(t.app.db, adminId, (tx) => adminFindUser(tx, b.ownerUserId)),
    ).toBeNull();
    await t.admin.db.update(users).set({ blocked: false }).where(eq(users.id, adminId));
  });

  it('шаблоны сообщений — из справочников платформы', async () => {
    expect(await messageTemplates(t.app.db)).toEqual({});
    await t.admin.db.insert(platformReference).values({
      key: 'messageTemplates',
      payload: { tgCode: 'Код: {код}', broken: 5 },
      checksum: 'x',
      source: 'test',
    });
    expect(await messageTemplates(t.app.db)).toEqual({ tgCode: 'Код: {код}' });
  });
});
