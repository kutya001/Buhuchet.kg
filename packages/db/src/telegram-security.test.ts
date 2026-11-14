import { createHash, randomBytes } from 'node:crypto';
import { NOT_ME_ACTION, securityBotMessage, type OutboxKind } from '@buhuchet/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findLogin, LoginClosedError, startSession, withUserContext } from './auth';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  employees,
  passwordResetCodes,
  roles,
  sessionLog,
  sessions,
  telegramLinkGuards,
  telegramLinks,
  telegramLinkTokens,
  telegramOutbox,
  users,
} from './schema';
import { setTemporaryPassword } from './telegram';
import { botPressTarget, logBotMessage, telegramNotMe, telegramNotMeInert } from './telegram-bot';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const NOW = new Date('2026-11-14T03:15:27.000Z');
const TEXTS = {
  staffText: 'Сотрудник нажал «Это не я»',
  ownerText: 'Владелец нажал «Это не я»',
  hours: 24,
};

describe.skipIf(!databaseAvailable())('«Это не я» под сообщениями о безопасности (Т4)', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId: string;
  let staffId: string;
  let messageNo = 500;

  const asUser = (orgId: string, userId: string) => ({ orgId, userId });
  const token = () => createHash('sha256').update(randomBytes(32)).digest('hex');
  const linkOf = async (userId: string) =>
    (await t.admin.db.select().from(telegramLinks).where(eq(telegramLinks.userId, userId)))[0];
  const guardOf = async (userId: string) =>
    (
      await t.admin.db
        .select()
        .from(telegramLinkGuards)
        .where(eq(telegramLinkGuards.userId, userId))
    )[0];
  const userOf = async (userId: string) =>
    (await t.admin.db.select().from(users).where(eq(users.id, userId)))[0]!;

  /** Сообщение о безопасности с кнопкой — в журнал, как после отправки; возвращает номер в чате. */
  async function notice(userId: string, chatId: number, kind: OutboxKind) {
    const messageId = ++messageNo;
    await logBotMessage(t.app.db, {
      userId,
      chatId,
      kind,
      text: 'Сообщение о безопасности',
      ok: true,
      message: securityBotMessage('Сообщение о безопасности', 'pass', NOW, 'Это не я'),
      messageId,
    });
    return messageId;
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedAccessReference(t.admin.db);
    const org = (name: string, inn: string, slug: string, login: string) =>
      createOrganization(t.app.db, {
        name,
        inn,
        slug,
        owner: { fullName: `Владелец ${login}`, login, passwordHash: 'h' },
      });
    a = await org('Организация А', '01811201810456', 'org-a', 'owner-a');
    b = await org('Организация Б', '02811201810457', 'org-b', 'owner-b');
    const [admin] = await t.admin.db
      .insert(users)
      .values({ login: 'platform', passwordHash: 'h', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    // Сотрудник организации Б с ролью не владельца.
    const [role] = await t.admin.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.orgId, b.orgId), eq(roles.isOwner, false)));
    const [staff] = await t.admin.db
      .insert(users)
      .values({ orgId: b.orgId, login: 'staff-b', passwordHash: 'h' })
      .returning({ id: users.id });
    staffId = staff!.id;
    await t.admin.db.insert(employees).values({
      orgId: b.orgId,
      userId: staffId,
      fullName: 'Сотрудник Б',
      shortName: 'Сотрудник Б.',
      roleId: role!.id,
    });
    await t.admin.db.update(users).set({ mustChangePassword: false });
    await t.admin.db.insert(telegramLinks).values([
      { userId: a.ownerUserId, orgId: a.orgId, chatId: 7001, username: 'owner_a' },
      { userId: b.ownerUserId, orgId: b.orgId, chatId: 7002, firstName: 'Владелец Б' },
      { userId: staffId, orgId: b.orgId, chatId: 7003 },
      { userId: adminId, orgId: null, chatId: 9000 },
    ]);
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('сообщения о безопасности в этот чат не было — нажатие ничего не делает', async () => {
    await startSession(t.app.db, { userId: staffId, tokenHash: token() });
    // Обычное сообщение с кнопкой — не сообщение о безопасности.
    await notice(staffId, 7003, 'bot_test');
    const done = await withOrgContext(t.app.db, asUser(b.orgId, staffId), (tx) =>
      telegramNotMe(tx, { chatId: 7003, ...TEXTS, now: NOW }),
    );
    expect(done).toBeNull();
    expect((await userOf(staffId)).loginLockedAt).toBeNull();
    expect(
      await t.admin.db.select().from(sessions).where(eq(sessions.userId, staffId)),
    ).toHaveLength(1);
  });

  it('сотрудник: сеансы завершены, вход закрыт с причиной, коды и ссылки отменены, владельцу — сообщение', async () => {
    await notice(staffId, 7003, 'pass_changed');
    await startSession(t.app.db, { userId: staffId, tokenHash: token() });
    await t.admin.db.insert(telegramLinkTokens).values({
      userId: staffId,
      orgId: b.orgId,
      tokenHash: token(),
      expiresAt: new Date(Date.now() + 600_000),
    });
    await t.admin.db.insert(passwordResetCodes).values({
      userId: staffId,
      orgId: b.orgId,
      codeHash: 'h',
      expiresAt: new Date(Date.now() + 600_000),
    });
    // Чужой контекст: владелец организации А в чате сотрудника Б ничего не закрывает.
    expect(
      await withOrgContext(t.app.db, asUser(a.orgId, a.ownerUserId), (tx) =>
        telegramNotMe(tx, { chatId: 7003, ...TEXTS, now: NOW }),
      ),
    ).toBeNull();

    const done = await withOrgContext(t.app.db, asUser(b.orgId, staffId), (tx) =>
      telegramNotMe(tx, { chatId: 7003, ...TEXTS, now: NOW }),
    );
    expect(done).toMatchObject({
      status: 'done',
      sessions: 2,
      cut: null,
      locked: true,
      isOwner: false,
    });
    expect(done!.queued).toHaveLength(1);
    const user = await userOf(staffId);
    expect(user.loginLockedAt).not.toBeNull();
    expect(user.loginLockReason).toBe('not_me');
    expect(
      await t.admin.db.select().from(sessions).where(eq(sessions.userId, staffId)),
    ).toHaveLength(0);
    const log = await t.admin.db.select().from(sessionLog).where(eq(sessionLog.userId, staffId));
    expect(log.map((s) => s.endReason)).toEqual(['not_me', 'not_me']);
    // Чат, из которого нажали, остаётся привязанным.
    expect((await linkOf(staffId))?.chatId).toBe(7003);
    const [linkToken] = await t.admin.db
      .select()
      .from(telegramLinkTokens)
      .where(eq(telegramLinkTokens.userId, staffId));
    // Отменена «-infinity»: драйвер отдаёт такую дату как неверную.
    expect(linkToken!.expiresAt.getTime() > Date.now()).toBe(false);
    const [code] = await t.admin.db
      .select()
      .from(passwordResetCodes)
      .where(eq(passwordResetCodes.userId, staffId));
    expect(code!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    // Владельцу организации — сообщение в очередь; администратору платформы и чужой организации — нет.
    const queued = await t.admin.db
      .select()
      .from(telegramOutbox)
      .where(eq(telegramOutbox.kind, 'not_me'));
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      id: done!.queued[0],
      orgId: b.orgId,
      userId: b.ownerUserId,
      chatId: 7002,
      text: TEXTS.staffText,
      status: 'pending',
    });
    expect(await findLogin(t.app.db, 'staff-b')).toMatchObject({
      loginLocked: true,
      loginLockReason: 'not_me',
    });
  });

  it('вход уже закрыт — второе нажатие ничего не меняет; новый пароль от владельца открывает вход', async () => {
    const again = await withOrgContext(t.app.db, asUser(b.orgId, staffId), (tx) =>
      telegramNotMe(tx, { chatId: 7003, ...TEXTS, now: NOW }),
    );
    expect(again).toMatchObject({ status: 'locked', locked: false, queued: [] });
    const reset = await withOrgContext(t.app.db, asUser(b.orgId, b.ownerUserId), (tx) =>
      setTemporaryPassword(tx, { userId: staffId, passwordHash: 'h2' }),
    );
    expect(reset?.loginLockedBefore).toBe(true);
    const user = await userOf(staffId);
    expect(user.loginLockedAt).toBeNull();
    expect(user.loginLockReason).toBeNull();
    expect(await findLogin(t.app.db, 'staff-b')).toMatchObject({
      loginLocked: false,
      loginLockReason: null,
    });
  });

  it('привязан другой Telegram: кнопка в прежнем чате принимается, другой Telegram отвязан, прежний чат остаётся «прежним»', async () => {
    // Вместо чата 7001 привязан чужой 7010 — как после замены Telegram.
    await t.admin.db
      .update(telegramLinks)
      .set({ chatId: 7010, username: 'stranger' })
      .where(eq(telegramLinks.userId, a.ownerUserId));
    const messageId = await notice(a.ownerUserId, 7001, 'relinked');
    // Сообщение в непривязанный чат находится по нажатию — только у сообщений о замене и отвязке.
    expect(await botPressTarget(t.app.db, 7001, messageId)).toMatchObject({
      userId: a.ownerUserId,
      linked: false,
    });
    const other = await notice(a.ownerUserId, 7001, 'bot_test');
    expect(await botPressTarget(t.app.db, 7001, other)).toBeNull();

    const done = await withOrgContext(t.app.db, asUser(a.orgId, a.ownerUserId), (tx) =>
      telegramNotMe(tx, { chatId: 7001, ...TEXTS, now: NOW }),
    );
    expect(done).toMatchObject({
      status: 'done',
      cut: { username: 'stranger', firstName: null },
      locked: true,
      isOwner: true,
    });
    expect(await linkOf(a.ownerUserId)).toBeUndefined();
    expect(await guardOf(a.ownerUserId)).toMatchObject({ chatId: 7001, freeUntil: null });
    // О владельце — администратору платформы, без организации.
    const [toAdmin] = await t.admin.db
      .select()
      .from(telegramOutbox)
      .where(and(eq(telegramOutbox.kind, 'not_me'), eq(telegramOutbox.userId, adminId)));
    expect(toAdmin).toMatchObject({ orgId: null, chatId: 9000, text: TEXTS.ownerText });
    expect(done!.queued).toEqual([toAdmin!.id]);
  });

  it('пароль сброшен владельцем: прежние кнопки погашены, из прежнего чата вход заново не закрыть', async () => {
    // Сброс пароля в предыдущем тесте погасил кнопку под сообщением, отправленным до него.
    const before = await t.admin.db
      .select({ payload: telegramOutbox.payload })
      .from(telegramOutbox)
      .where(and(eq(telegramOutbox.userId, staffId), eq(telegramOutbox.kind, 'pass_changed')));
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((m) => m.payload === null)).toBe(true);
    const press = () =>
      withOrgContext(t.app.db, asUser(b.orgId, staffId), (tx) =>
        telegramNotMe(tx, { chatId: 7003, ...TEXTS, now: NOW }),
      );
    expect(await press()).toBeNull();

    // Временный пароль: и новая кнопка ничего не закрывает.
    await notice(staffId, 7003, 'pass_changed');
    expect(await telegramNotMeInert(t.app.db, staffId)).toBe(true);
    expect(await press()).toMatchObject({ status: 'reset', locked: false, sessions: 0 });
    // Пароль заменён своим, но разрешение привязать Telegram без кода ещё действует — то же.
    await t.admin.db.update(users).set({ mustChangePassword: false }).where(eq(users.id, staffId));
    expect((await guardOf(staffId))?.freeUntil).not.toBeNull();
    expect(await telegramNotMeInert(t.app.db, staffId)).toBe(true);
    expect(await press()).toMatchObject({ status: 'reset', locked: false });
    expect((await guardOf(staffId))?.freeUntil).not.toBeNull();
    expect((await userOf(staffId)).loginLockedAt).toBeNull();

    // Разрешение истекло — кнопка снова действует; сообщение старше срока кнопки не принимается.
    await t.admin.db
      .update(telegramLinkGuards)
      .set({ freeUntil: null })
      .where(eq(telegramLinkGuards.userId, staffId));
    expect(await telegramNotMeInert(t.app.db, staffId)).toBe(false);
    await t.admin.db
      .update(telegramOutbox)
      .set({ sentAt: new Date(Date.now() - 25 * 3600_000) })
      .where(eq(telegramOutbox.userId, staffId));
    expect(await press()).toBeNull();
  });

  it('вход закрыт неверными паролями: нажатие всё равно завершает сеансы, новый сеанс не начинается', async () => {
    await startSession(t.app.db, { userId: staffId, tokenHash: token() });
    // Блокировка после 10 неверных паролей открытых сеансов не завершает.
    await t.admin.db.update(users).set({ loginLockedAt: new Date() }).where(eq(users.id, staffId));
    await expect(
      startSession(t.app.db, { userId: staffId, tokenHash: token() }),
    ).rejects.toBeInstanceOf(LoginClosedError);
    await notice(staffId, 7003, 'pass_changed');
    const done = await withOrgContext(t.app.db, asUser(b.orgId, staffId), (tx) =>
      telegramNotMe(tx, { chatId: 7003, ...TEXTS, now: NOW }),
    );
    expect(done).toMatchObject({ status: 'done', sessions: 1, locked: true });
    expect(await userOf(staffId)).toMatchObject({ loginLockReason: 'not_me' });
    expect(
      await t.admin.db.select().from(sessions).where(eq(sessions.userId, staffId)),
    ).toHaveLength(0);
    // Вход закрыт — сеанс не начинается и у того, кто успел проверить пароль до нажатия.
    await expect(
      startSession(t.app.db, { userId: staffId, tokenHash: token() }),
    ).rejects.toBeInstanceOf(LoginClosedError);
    await t.admin.db
      .update(users)
      .set({ loginLockedAt: null, loginLockReason: null })
      .where(eq(users.id, staffId));
  });

  it('Telegram отвязан: чат остаётся «прежним» со своим именем; пока действует разрешение без кода — отказ', async () => {
    await t.admin.db.delete(telegramLinks).where(eq(telegramLinks.userId, b.ownerUserId));
    await t.admin.db.insert(telegramLinkGuards).values({
      userId: b.ownerUserId,
      orgId: b.orgId,
      chatId: 7002,
      firstName: 'Владелец Б',
      freeUntil: new Date(Date.now() + 3600_000),
    });
    await notice(b.ownerUserId, 7002, 'unlinked');
    const press = () =>
      withOrgContext(t.app.db, asUser(b.orgId, b.ownerUserId), (tx) =>
        telegramNotMe(tx, { chatId: 7002, ...TEXTS, now: NOW }),
      );
    // Пароль сбросил администратор платформы: разрешение из прежнего чата не отменить.
    expect(await press()).toMatchObject({ status: 'reset', locked: false });
    expect((await guardOf(b.ownerUserId))?.freeUntil).not.toBeNull();
    await t.admin.db
      .update(telegramLinkGuards)
      .set({ freeUntil: null })
      .where(eq(telegramLinkGuards.userId, b.ownerUserId));
    const done = await press();
    expect(done).toMatchObject({ status: 'done', cut: null, locked: true, isOwner: true });
    expect(await guardOf(b.ownerUserId)).toMatchObject({
      chatId: 7002,
      firstName: 'Владелец Б',
      freeUntil: null,
    });
  });

  it('администратор платформы: сеансы завершены, вход не закрывается, сообщений нет', async () => {
    await notice(adminId, 9000, 'pass_changed');
    await startSession(t.app.db, { userId: adminId, tokenHash: token() });
    const before = await t.admin.db
      .select()
      .from(telegramOutbox)
      .where(eq(telegramOutbox.kind, 'not_me'));
    const done = await withUserContext(t.app.db, adminId, (tx) =>
      telegramNotMe(tx, { chatId: 9000, ...TEXTS, now: NOW }),
    );
    expect(done).toMatchObject({ status: 'done', sessions: 1, locked: false, queued: [] });
    const user = await userOf(adminId);
    expect(user.loginLockedAt).toBeNull();
    expect(user.loginLockReason).toBeNull();
    expect(
      await t.admin.db.select().from(sessions).where(eq(sessions.userId, adminId)),
    ).toHaveLength(0);
    expect(
      await t.admin.db.select().from(telegramOutbox).where(eq(telegramOutbox.kind, 'not_me')),
    ).toHaveLength(before.length);
  });

  it('заблокированная учётная запись — отказ, ничего не меняется', async () => {
    await t.admin.db.update(users).set({ blocked: true }).where(eq(users.id, staffId));
    await startSession(t.app.db, { userId: staffId, tokenHash: token() });
    const done = await withOrgContext(t.app.db, asUser(b.orgId, staffId), (tx) =>
      telegramNotMe(tx, { chatId: 7003, ...TEXTS, now: NOW }),
    );
    expect(done).toMatchObject({ status: 'denied', locked: false });
    expect((await userOf(staffId)).loginLockedAt).toBeNull();
    expect(
      await t.admin.db.select().from(sessions).where(eq(sessions.userId, staffId)),
    ).toHaveLength(1);
  });

  it('кнопка «Это не я» в описании сообщения — с кодом действия', () => {
    const m = securityBotMessage('Текст', 'unlink', NOW, 'Это не я');
    expect(m.buttons?.[0]?.[0]).toMatchObject({ action: NOT_ME_ACTION });
  });
});
