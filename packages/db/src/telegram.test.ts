import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeOwnPassword, sessionByToken, startSession, withUserContext } from './auth';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import { getEmployee } from './staff';
import type { Tx } from './client';
import {
  employees,
  loginAttempts,
  messageTemplateTexts,
  passwordResetCodes,
  sessions,
  telegramLinkGuards,
  telegramLinks,
  telegramLinkTokens,
  telegramRelinkCodes,
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
  requestTelegramRelink,
  reservePasswordResetAttempt,
  reserveTelegramRelinkAttempt,
  setTemporaryPassword,
  telegramChat,
  telegramPreviousChat,
  unlinkTelegram,
  useTelegramLink,
  useTelegramRelink,
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
  /**
   * Другой чат вместо прежнего — кодом из прежнего (docs/deviations.md п. О-20): ссылка, код записан
   * (хеш сверяет API — здесь он «верный» без проверки), попытка из нового чата, привязка.
   */
  const relinkAs = async (
    ctx: { orgId: string; userId: string },
    chatId: number,
    username: string | null = null,
  ) => {
    const token = newHash();
    await withOrgContext(t.app.db, ctx, (tx) => createTelegramLinkToken(tx, token));
    const sent = await withOrgContext(t.app.db, ctx, (tx) =>
      requestTelegramRelink(tx, {
        tokenHash: token,
        chatId,
        username,
        firstName: 'Имя',
        codeHash: 'relink-code',
      }),
    );
    expect(sent).toMatchObject({ status: 'sent' });
    const attempt = await reserveTelegramRelinkAttempt(t.app.db, chatId);
    if (attempt.status !== 'ok') throw new Error(`код замены: ${attempt.status}`);
    expect(attempt).toMatchObject({ userId: ctx.userId, codeHash: 'relink-code' });
    return withOrgContext(t.app.db, ctx, (tx) => useTelegramRelink(tx, attempt.codeId));
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
    // Владельцы уже сменили временный пароль: с ним ссылку привязки не создать (миграция 0103).
    await t.admin.db.update(users).set({ mustChangePassword: false });
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
    expect(used).toEqual({ previous: null, shared: false, unlinked: null });
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

    // Другой чат вместо прежнего ссылкой не привязывается — только кодом из прежнего (Р-13 Б).
    expect(await linkAs(ctxA(), 5003, 'erkin_new')).toBeNull();
    expect(await telegramChat(t.app.db, a.ownerUserId)).toMatchObject({ chatId: 5001 });
    expect(await relinkAs(ctxA(), 5003, 'erkin_new')).toEqual({
      previous: { chatId: 5001, username: 'erkin_s', firstName: 'Эркин', shared: false },
      shared: false,
      unlinked: null,
    });
    expect(await telegramChat(t.app.db, a.ownerUserId)).toMatchObject({ chatId: 5003 });
    // Тот же чат ещё раз — без кода.
    expect(await linkAs(ctxA(), 5003, 'erkin_new')).toMatchObject({
      previous: { chatId: 5003 },
    });
  });

  it('один Telegram у нескольких логинов, в том числе в разных организациях и у администратора', async () => {
    expect(await linkAs({ orgId: b.orgId, userId: b.ownerUserId }, 5003)).toMatchObject({
      shared: true,
    });
    expect(await telegramChat(t.app.db, a.ownerUserId)).toMatchObject({ shared: true });
    expect(await linkAs({ admin: adminId }, 7001, 'admin')).toEqual({
      previous: null,
      shared: false,
      unlinked: null,
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
    await withOrgContext(t.app.db, { orgId: b.orgId, userId: b.ownerUserId }, (tx) =>
      createTelegramLinkToken(tx, newHash()),
    );
    // Код замены Telegram (Б раньше отвязал 5003 — новый чат только по коду) и отметка «прежний чат».
    await relinkAs({ orgId: b.orgId, userId: b.ownerUserId }, 6002);
    await requestPasswordReset(t.app.db, { userId: b.ownerUserId, codeHash: 'code-b' });
    await t.admin.db
      .insert(telegramLinkGuards)
      .values({ userId: b.ownerUserId, orgId: b.orgId, chatId: 6000 });
    for (const table of [
      telegramLinks,
      telegramLinkTokens,
      passwordResetCodes,
      telegramLinkGuards,
      telegramRelinkCodes,
    ]) {
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
      // Ни снять отметку «прежний чат», ни разрешить замену без кода, ни подставить свой код замены.
      (tx: Tx) => tx.delete(telegramLinkGuards).where(eq(telegramLinkGuards.userId, b.ownerUserId)),
      (tx: Tx) =>
        tx.insert(telegramLinkGuards).values({
          userId: a.ownerUserId,
          orgId: a.orgId,
          freeUntil: new Date(Date.now() + 60_000),
        }),
      (tx: Tx) =>
        tx
          .update(telegramRelinkCodes)
          .set({ attempts: 0 })
          .where(eq(telegramRelinkCodes.userId, a.ownerUserId)),
      (tx: Tx) =>
        tx.insert(telegramRelinkCodes).values({
          userId: a.ownerUserId,
          orgId: a.orgId,
          tokenHash: 'x',
          chatId: 1,
          codeHash: 'x',
          expiresAt: new Date(Date.now() + 60_000),
        }),
      // Вспомогательные функции привязки — только изнутри функций app.telegram_*.
      (tx: Tx) =>
        tx.execute(
          sql`select * from app.telegram_link_set(${b.ownerUserId}, ${b.orgId}, 1, null, null)`,
        ),
      (tx: Tx) => tx.execute(sql`select * from app.telegram_confirm_chat(${b.ownerUserId})`),
      (tx: Tx) => tx.execute(sql`select app.telegram_relink_failures(${b.ownerUserId})`),
    ];
    for (const attempt of attempts) {
      await expect(withOrgContext(t.app.db, ctxA(), attempt)).rejects.toThrow(permissionDenied);
    }
    expect(await telegramChat(t.app.db, b.ownerUserId)).toMatchObject({ chatId: 6002 });
    const [guardB] = await t.admin.db
      .select()
      .from(telegramLinkGuards)
      .where(eq(telegramLinkGuards.userId, b.ownerUserId));
    expect(guardB).toMatchObject({ chatId: 6000, freeUntil: null });
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
    ).toEqual({ mustChangePasswordBefore: false, loginLockedBefore: false });
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

    // Временный пароль из предыдущей проверки уже сменён.
    await t.admin.db.update(users).set({ mustChangePassword: false }).where(eq(users.id, accA));
    await linkAs({ orgId: a.orgId, userId: accA }, 5010);
    expect(
      await pendingAfter(accA, () =>
        withOrgContext(t.app.db, { orgId: a.orgId, userId: accA }, unlinkTelegram),
      ),
    ).toBe(false);

    // Тот же чат после «Отвязать» привязывается снова без кода.
    expect(await linkAs({ orgId: a.orgId, userId: accA }, 5010)).not.toBeNull();
    expect(
      await pendingAfter(accA, () =>
        withOrgContext(t.app.db, ctxA(), (tx) =>
          setTemporaryPassword(tx, { userId: accA, passwordHash: 'temp-2' }),
        ),
      ),
    ).toBe(false);
    // После сброса, пока действует разрешение без кода, новый код в прежний чат не уходит.
    expect(await requestPasswordReset(t.app.db, { userId: accA, codeHash: 'x' })).toEqual({
      status: 'no_telegram',
    });

    // Замена Telegram на другой чат (кодом из прежнего) отменяет код, повторная привязка того же
    // чата — нет. После сброса пароля (временный пароль сменён) 5011 привязывается без кода.
    await t.admin.db.update(users).set({ mustChangePassword: false }).where(eq(users.id, accA));
    expect(await linkAs({ orgId: a.orgId, userId: accA }, 5011)).not.toBeNull();
    expect(await pendingAfter(accA, () => relinkAs({ orgId: a.orgId, userId: accA }, 5012))).toBe(
      false,
    );
    expect(await pendingAfter(accA, () => linkAs({ orgId: a.orgId, userId: accA }, 5012))).toBe(
      true,
    );
  });

  /** Новая учётная запись организации А без сотрудника (свой счёт кодов замены). */
  const newUser = async (login: string) => {
    const [u] = await t.admin.db
      .insert(users)
      .values({ orgId: a.orgId, login, passwordHash: 'hash' })
      .returning({ id: users.id });
    return { orgId: a.orgId, userId: u!.id };
  };
  const relinkRequest = (ctx: { orgId: string; userId: string }, chatId: number, code: string) =>
    withOrgContext(t.app.db, ctx, async (tx) => {
      const token = newHash();
      await createTelegramLinkToken(tx, token);
      const result = await requestTelegramRelink(tx, {
        tokenHash: token,
        chatId,
        username: null,
        firstName: null,
        codeHash: code,
      });
      return { token, result };
    });

  it('замена Telegram кодом из прежнего чата: 10 минут, 5 попыток на код, не больше 3 кодов в час и 10 неверных за сутки', async () => {
    const x = await newUser('relink-x');
    expect(await linkAs(x, 9001)).toMatchObject({ previous: null });
    const before = Date.now();
    const first = await relinkRequest(x, 9002, 'c1');
    expect(first.result).toMatchObject({ status: 'sent', chatId: 9001, shared: false });
    const minutes = ((first.result as { expiresAt: Date }).expiresAt.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(9.9);
    expect(minutes).toBeLessThan(10.1);
    // Ссылка использована: повтор от Telegram виден по relinkChatId, второй раз код не записать.
    expect(await peekTelegramLink(t.app.db, first.token)).toMatchObject({
      used: true,
      linkedChatId: 9001,
      confirmChatId: 9001,
      relinkFree: false,
      relinkChatId: 9002,
    });
    expect(
      await withOrgContext(t.app.db, x, (tx) =>
        requestTelegramRelink(tx, {
          tokenHash: first.token,
          chatId: 9002,
          username: null,
          firstName: null,
          codeHash: 'again',
        }),
      ),
    ).toEqual({ status: 'invalid' });
    // Ссылку открыли в том же чате — код не нужен.
    expect((await relinkRequest(x, 9001, 'same')).result).toEqual({ status: 'not_needed' });
    // Код ждут только в новом чате; 5 попыток, потом код не действует.
    expect(await reserveTelegramRelinkAttempt(t.app.db, 9003)).toEqual({ status: 'none' });
    const left = [];
    for (let i = 0; i < 5; i++) {
      const r = await reserveTelegramRelinkAttempt(t.app.db, 9002);
      left.push(r.status === 'ok' ? r.triesLeft : r.status);
    }
    expect(left).toEqual([4, 3, 2, 1, 0]);
    expect(await reserveTelegramRelinkAttempt(t.app.db, 9002)).toEqual({ status: 'spent' });
    // Не больше 3 кодов в час.
    expect((await relinkRequest(x, 9002, 'c2')).result).toMatchObject({ status: 'sent' });
    expect((await relinkRequest(x, 9002, 'c3')).result).toMatchObject({ status: 'sent' });
    const fourth = await relinkRequest(x, 9002, 'c4');
    expect(fourth.result).toEqual({ status: 'limited' });
    // Ссылка использована и при отказе: повтор «/start» не заставит снова считать хеш кода.
    expect(await peekTelegramLink(t.app.db, fourth.token)).toMatchObject({ used: true });
    // Новый код отменяет прежний: попытка — у последнего.
    const latest = await reserveTelegramRelinkAttempt(t.app.db, 9002);
    expect(latest).toMatchObject({ status: 'ok', codeHash: 'c3', userId: x.userId });
    // За сутки не больше 10 неверных вводов, «осталось» — меньший из остатков по коду и за сутки:
    // у c1 будто бы 7 неверных, с c3 — 8, ещё два — и коды закрыты на сутки.
    await t.admin.db
      .update(telegramRelinkCodes)
      .set({ attempts: 7 })
      .where(eq(telegramRelinkCodes.codeHash, 'c1'));
    const more = [];
    for (let i = 0; i < 3; i++) {
      const r = await reserveTelegramRelinkAttempt(t.app.db, 9002);
      more.push(r.status === 'ok' ? r.triesLeft : r.status);
    }
    expect(more).toEqual([1, 0, 'spent']);
    await t.admin.db
      .update(telegramRelinkCodes)
      .set({ createdAt: sql`now() - interval '2 hours'` })
      .where(eq(telegramRelinkCodes.userId, x.userId));
    expect((await relinkRequest(x, 9002, 'c5')).result).toEqual({ status: 'locked' });
    // Чужой код и использованный не привязывают; верный — привязывает один раз.
    await t.admin.db.delete(telegramRelinkCodes).where(eq(telegramRelinkCodes.userId, x.userId));
    expect((await relinkRequest(x, 9002, 'c6')).result).toMatchObject({ status: 'sent' });
    const ok = await reserveTelegramRelinkAttempt(t.app.db, 9002);
    if (ok.status !== 'ok') throw new Error(ok.status);
    expect(await withOrgContext(t.app.db, ctxA(), (tx) => useTelegramRelink(tx, ok.codeId))).toBe(
      null,
    );
    expect(await withOrgContext(t.app.db, x, (tx) => useTelegramRelink(tx, ok.codeId))).toEqual({
      previous: { chatId: 9001, username: null, firstName: 'Имя', shared: false },
      shared: false,
      unlinked: null,
    });
    expect(await telegramChat(t.app.db, x.userId)).toMatchObject({ chatId: 9002 });
    expect(await withOrgContext(t.app.db, x, (tx) => useTelegramRelink(tx, ok.codeId))).toBe(null);
    // Истёкший код — «попытки кончились».
    expect((await relinkRequest(x, 9004, 'c7')).result).toMatchObject({ status: 'sent' });
    await t.admin.db
      .update(telegramRelinkCodes)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(telegramRelinkCodes.userId, x.userId));
    expect(await reserveTelegramRelinkAttempt(t.app.db, 9004)).toEqual({ status: 'spent' });
  });

  it('после «Отвязать» другой чат — тоже кодом из отвязанного, тот же — без кода; после сброса пароля сутки без кода', async () => {
    const y = await newUser('relink-y');
    expect(await telegramPreviousChat(t.app.db, y.userId)).toBeNull();
    await linkAs(y, 9101, 'y_first');
    expect(await telegramPreviousChat(t.app.db, y.userId)).toBeNull();
    await withOrgContext(t.app.db, y, unlinkTelegram);
    // Прежний Telegram — для подсказки в «Мой профиль» (прототип v77).
    expect(await telegramPreviousChat(t.app.db, y.userId)).toEqual({
      username: 'y_first',
      firstName: 'Имя',
    });
    expect(await linkAs(y, 9102)).toBeNull();
    expect(await telegramChat(t.app.db, y.userId)).toBeNull();
    // Тот же чат — без кода; о замене писать некому.
    expect(await linkAs(y, 9101)).toEqual({ previous: null, shared: false, unlinked: null });
    expect(await telegramPreviousChat(t.app.db, y.userId)).toBeNull();
    // Код — в отвязанный чат, ему же — о замене.
    await withOrgContext(t.app.db, y, unlinkTelegram);
    expect((await relinkRequest(y, 9103, 'r1')).result).toMatchObject({
      status: 'sent',
      chatId: 9101,
    });
    const code = await reserveTelegramRelinkAttempt(t.app.db, 9103);
    if (code.status !== 'ok') throw new Error(code.status);
    expect(await withOrgContext(t.app.db, y, (tx) => useTelegramRelink(tx, code.codeId))).toEqual({
      previous: null,
      shared: false,
      unlinked: { chatId: 9101, shared: false },
    });

    // Сброс пароля владельцем: доступа к прежнему Telegram может не быть — сутки без кода, один раз.
    // Запросы, которые начались до сброса, разрешение не снимут (docs/deviations.md п. О-20): привязка
    // ссылкой, взятой до сброса, и новая ссылка, которую создают, пока сброс ещё не зафиксирован.
    const signal = () => {
      let fire!: () => void;
      const fired = new Promise<void>((resolve) => (fire = resolve));
      return { fire, fired };
    };
    const early = newHash();
    await withOrgContext(t.app.db, y, (tx) => createTelegramLinkToken(tx, early));
    // Привязка той же ссылкой в том же чате началась до сброса, а до проверки ссылки дошла после него.
    const began = signal();
    const resetDone = signal();
    const lateUse = withOrgContext(t.app.db, y, async (tx) => {
      began.fire();
      await resetDone.fired;
      return useTelegramLink(tx, {
        tokenHash: early,
        chatId: 9103,
        username: null,
        firstName: null,
      });
    });
    await began.fired;
    await withOrgContext(t.app.db, ctxA(), (tx) =>
      setTemporaryPassword(tx, { userId: y.userId, passwordHash: 'temp-y' }),
    );
    resetDone.fire();
    expect(await lateUse).toBeNull();
    // Новую ссылку создают, пока сброс ещё не зафиксирован: она ждёт его и видит временный пароль (с
    // ним API пускает только к смене пароля). Повторный сброс — после смены временного пароля.
    await t.admin.db.update(users).set({ mustChangePassword: false }).where(eq(users.id, y.userId));
    const before = Date.now();
    const locked = signal();
    const commit = signal();
    const reset = withOrgContext(t.app.db, ctxA(), async (tx) => {
      await setTemporaryPassword(tx, { userId: y.userId, passwordHash: 'temp-y' });
      locked.fire();
      await commit.fired;
    });
    await locked.fired;
    const lateLink = withOrgContext(t.app.db, y, (tx) => createTelegramLinkToken(tx, newHash()));
    await new Promise((resolve) => setTimeout(resolve, 100));
    commit.fire();
    await reset;
    await expect(lateLink).rejects.toMatchObject({
      cause: { message: expect.stringContaining('временный пароль') },
    });
    const [guard] = await t.admin.db
      .select()
      .from(telegramLinkGuards)
      .where(eq(telegramLinkGuards.userId, y.userId));
    const hours = (guard!.freeUntil!.getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
    // Пока разрешение действует, код «Забыли пароль?» в ещё привязанный (возможно, чужой) чат не уходит.
    expect(await passwordResetStatus(t.app.db, y.userId)).toEqual({ status: 'no_telegram' });
    // Пострадавший вошёл с временным паролем и сменил его.
    await t.admin.db.update(users).set({ mustChangePassword: false }).where(eq(users.id, y.userId));
    // Через сутки разрешение истекает, и коды снова уходят в привязанный чат.
    const setFreeUntil = (freeUntil: Date) =>
      t.admin.db
        .update(telegramLinkGuards)
        .set({ freeUntil })
        .where(eq(telegramLinkGuards.userId, y.userId));
    await setFreeUntil(new Date(Date.now() - 1000));
    expect(await passwordResetStatus(t.app.db, y.userId)).toEqual({ status: 'ok' });
    await setFreeUntil(guard!.freeUntil!);
    const token = newHash();
    await withOrgContext(t.app.db, y, (tx) => createTelegramLinkToken(tx, token));
    expect(await peekTelegramLink(t.app.db, token)).toMatchObject({
      confirmChatId: 9103,
      relinkFree: true,
    });
    expect(await linkAs(y, 9104)).toMatchObject({ previous: { chatId: 9103 } });
    // Новая привязка снимает разрешение — коды снова уходят, уже в новый чат.
    expect(await passwordResetStatus(t.app.db, y.userId)).toEqual({ status: 'ok' });
    expect(await linkAs(y, 9105)).toBeNull();
    // Подсказка «Прежний Telegram …» — и пока после сброса пароля можно без кода (как в прототипе v77).
    await withOrgContext(t.app.db, y, unlinkTelegram);
    expect(await telegramPreviousChat(t.app.db, y.userId)).toEqual({
      username: null,
      firstName: 'Имя',
    });
    await setFreeUntil(new Date(Date.now() + 60_000));
    expect(await telegramPreviousChat(t.app.db, y.userId)).toEqual({
      username: null,
      firstName: 'Имя',
    });

    // Разрешить без кода можно только учётной записи своей организации с временным паролем.
    await t.admin.db.update(users).set({ mustChangePassword: true }).where(eq(users.id, y.userId));
    const allow = (ctx: { orgId: string; userId: string }, userId: string) =>
      withOrgContext(t.app.db, ctx, (tx) =>
        tx.execute(sql`select app.telegram_relink_allow(${userId}, 24)`),
      );
    await expect(allow(ctxA(), b.ownerUserId)).rejects.toThrow();
    // И только от имени владельца организации или администратора платформы, не сотрудника.
    await expect(allow({ orgId: a.orgId, userId: accA }, y.userId)).rejects.toThrow();
    await t.admin.db.update(users).set({ mustChangePassword: false }).where(eq(users.id, y.userId));
    await expect(allow(ctxA(), y.userId)).rejects.toThrow();
    await expect(
      withUserContext(t.app.db, adminId, (tx) =>
        tx.execute(sql`select app.telegram_relink_allow(${adminId}, 24)`),
      ),
    ).rejects.toThrow();
    // Администратору платформы ссылка привязки и с временным паролем: без Telegram он не войдёт в
    // Админку (код входа приходит туда).
    await t.admin.db.update(users).set({ mustChangePassword: true }).where(eq(users.id, adminId));
    expect(
      await withUserContext(t.app.db, adminId, (tx) => createTelegramLinkToken(tx, newHash())),
    ).toBeInstanceOf(Date);
    await t.admin.db.update(users).set({ mustChangePassword: false }).where(eq(users.id, adminId));
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
    await t.admin.db
      .insert(messageTemplateTexts)
      .values({ key: 'tgCode', text: 'Код: {код}', sortOrder: 1 });
    expect(await messageTemplates(t.app.db)).toEqual({ tgCode: 'Код: {код}' });
  });
});
