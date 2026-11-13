import { createHash, randomBytes } from 'node:crypto';
import type { BotMessage } from '@buhuchet/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { writeHistory } from './history';
import { createOrganization, type CreatedOrganization } from './organizations';
import { readPlatformHistory } from './platform-history';
import {
  auditLog,
  employees,
  statusHistory,
  telegramLinkGuards,
  telegramLinks,
  telegramOutbox,
  users,
} from './schema';
import { writeStatusChange } from './status';
import { createTelegramLinkToken, unlinkTelegram, useTelegramLink } from './telegram';
import {
  adminSetTelegramBotRich,
  botPressTarget,
  lockBotPress,
  logBotMessage,
  markViaTelegram,
  saveBotPress,
  setTelegramPlainText,
  telegramBotRich,
  telegramPlainText,
} from './telegram-bot';
import { claimOutbox, enqueueTelegram, finishOutbox } from './telegram-outbox';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }),
});

const message: BotMessage = {
  heading: 'Сегодня срок',
  text: 'НДС за октябрь',
  tables: [{ head: ['Контрагент', 'Отчёт'], rows: [['ОсОО «Ромашка»', 'НДС']] }],
  buttons: [
    [
      { text: 'Сдан', action: 'repDone', arg: 'r1' },
      { text: 'Открыть', url: 'https://buhuchet.kg/reports' },
    ],
  ],
};

describe.skipIf(!databaseAvailable())('Основа бота: сообщения с кнопками и нажатия (Т1)', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId: string;
  const ctxA = () => ({ orgId: a.orgId, userId: a.ownerUserId });
  const ctxB = () => ({ orgId: b.orgId, userId: b.ownerUserId });

  async function link(ctx: { orgId: string; userId: string }, chatId: number) {
    const token = createHash('sha256').update(randomBytes(32)).digest('hex');
    await withOrgContext(t.app.db, ctx, (tx) => createTelegramLinkToken(tx, token));
    await withOrgContext(t.app.db, ctx, (tx) =>
      useTelegramLink(tx, { tokenHash: token, chatId, username: null, firstName: null }),
    );
  }
  /** Записать отправленное сразу сообщение и вернуть строку журнала. */
  async function logged(userId: string, chatId: number, messageId: number, m = message) {
    await logBotMessage(t.app.db, {
      userId,
      chatId,
      kind: 'bot_test',
      text: 'Сегодня срок',
      ok: true,
      message: m,
      messageId,
    });
    const [row] = await t.admin.db
      .select()
      .from(telegramOutbox)
      .where(and(eq(telegramOutbox.chatId, chatId), eq(telegramOutbox.messageId, messageId)))
      .orderBy(desc(telegramOutbox.createdAt));
    return row!;
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
    await t.admin.db.update(users).set({ mustChangePassword: false });
    const [admin] = await t.admin.db
      .insert(users)
      .values({ login: 'platform', passwordHash: 'h', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    await link(ctxA(), 7001);
    await link(ctxB(), 7002);
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('журнал: описание сообщения и номер в чате пишутся; у кода и у неотправленного — нет', async () => {
    const row = await logged(a.ownerUserId, 7001, 101);
    expect(row).toMatchObject({
      orgId: a.orgId,
      userId: a.ownerUserId,
      status: 'sent',
      text: 'Сегодня срок',
      payload: message,
      messageId: 101,
    });
    await logBotMessage(t.app.db, {
      userId: a.ownerUserId,
      chatId: 7001,
      kind: 'code',
      text: '123456 — код',
      ok: true,
      message: { text: '123456 — код', code: '123456' },
      messageId: 102,
    });
    await logBotMessage(t.app.db, {
      userId: a.ownerUserId,
      chatId: 7001,
      kind: 'bot_test',
      text: 'Не ушло',
      ok: false,
      error: '403: bot was blocked',
      message,
    });
    const rows = await t.admin.db
      .select()
      .from(telegramOutbox)
      .where(eq(telegramOutbox.userId, a.ownerUserId))
      .orderBy(telegramOutbox.createdAt, telegramOutbox.id);
    const code = rows.find((r) => r.kind === 'code')!;
    expect(code).toMatchObject({ text: null, payload: null, messageId: 102, status: 'sent' });
    const failed = rows.find((r) => r.status === 'error')!;
    expect(failed).toMatchObject({
      payload: null,
      messageId: null,
      lastError: '403: bot was blocked',
    });
    // Описание сообщения с кодом не записать даже напрямую владельцу таблиц (ограничение таблицы).
    await expect(
      t.admin.db.execute(
        sql`update telegram_outbox set payload = '{"text":"x"}'::jsonb where id = ${code.id}`,
      ),
    ).rejects.toThrow();
    // Сообщение в чат, не привязанный к получателю: в журнале оно есть, но без описания и номера —
    // нажатие по нему не принять.
    await logBotMessage(t.app.db, {
      userId: a.ownerUserId,
      chatId: 7999,
      kind: 'bot_test',
      text: 'В чужой чат',
      ok: true,
      message,
      messageId: 103,
    });
    const [foreign] = await t.admin.db
      .select()
      .from(telegramOutbox)
      .where(eq(telegramOutbox.chatId, 7999));
    expect(foreign).toMatchObject({
      userId: a.ownerUserId,
      status: 'sent',
      text: 'В чужой чат',
      payload: null,
      messageId: null,
    });
    expect(await botPressTarget(t.app.db, 7999, 103)).toBeNull();
  });

  it('нажатие: сообщение находится только по своему чату и номеру, с состоянием учётной записи', async () => {
    const row = await logged(a.ownerUserId, 7001, 201);
    const target = await botPressTarget(t.app.db, 7001, 201);
    expect(target).toMatchObject({
      outboxId: row.id,
      userId: a.ownerUserId,
      orgId: a.orgId,
      login: 'owner-a',
      orgName: 'Организация А',
      message,
      linked: true,
      mustChangePassword: false,
      relinkFree: false,
      isPlatformAdmin: false,
      userBlocked: false,
      employeeActive: true,
      orgStatus: 'active',
      telegramActions: true,
    });
    expect(target!.employeeId).toEqual(expect.any(String));
    // Чужой чат с тем же номером сообщения, неизвестный номер, сообщение без кнопок и с кодом.
    expect(await botPressTarget(t.app.db, 7002, 201)).toBeNull();
    expect(await botPressTarget(t.app.db, 7001, 999)).toBeNull();
    expect(await botPressTarget(t.app.db, 7001, 102)).toBeNull();
    await logBotMessage(t.app.db, {
      userId: a.ownerUserId,
      chatId: 7001,
      kind: 'bot_test',
      text: 'Без описания',
      ok: true,
      messageId: 202,
    });
    expect(await botPressTarget(t.app.db, 7001, 202)).toBeNull();

    // Состояние учётной записи приходит вместе с сообщением: блокировки, переключатель, привязка.
    await t.admin.db
      .update(employees)
      .set({ active: false })
      .where(eq(employees.userId, a.ownerUserId));
    await t.admin.db.execute(
      sql`update org_settings set telegram_actions = false where org_id = ${a.orgId}`,
    );
    expect(await botPressTarget(t.app.db, 7001, 201)).toMatchObject({
      employeeActive: false,
      telegramActions: false,
      linked: true,
    });
    await t.admin.db
      .update(employees)
      .set({ active: true })
      .where(eq(employees.userId, a.ownerUserId));
    await t.admin.db.execute(
      sql`update org_settings set telegram_actions = true where org_id = ${a.orgId}`,
    );

    // Временный пароль и привязка Telegram без кода после сброса пароля — тоже в ответе.
    await t.admin.db
      .update(users)
      .set({ mustChangePassword: true })
      .where(eq(users.id, a.ownerUserId));
    const hour = 3_600_000;
    await t.admin.db.insert(telegramLinkGuards).values({
      userId: a.ownerUserId,
      orgId: a.orgId,
      freeUntil: new Date(Date.now() + hour),
    });
    expect(await botPressTarget(t.app.db, 7001, 201)).toMatchObject({
      mustChangePassword: true,
      relinkFree: true,
    });
    // Срок привязки без кода вышел — отметки нет.
    await t.admin.db
      .update(telegramLinkGuards)
      .set({ freeUntil: new Date(Date.now() - hour) })
      .where(eq(telegramLinkGuards.userId, a.ownerUserId));
    await t.admin.db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.id, a.ownerUserId));
    expect(await botPressTarget(t.app.db, 7001, 201)).toMatchObject({
      mustChangePassword: false,
      relinkFree: false,
    });
    await t.admin.db.delete(telegramLinkGuards).where(eq(telegramLinkGuards.userId, a.ownerUserId));
  });

  it('после нажатия описание меняет только получатель сообщения; чужая организация его не видит и не меняет', async () => {
    const row = await logged(a.ownerUserId, 7001, 301);
    const pressed: BotMessage = {
      ...message,
      buttons: [[{ text: 'Сдан ✓', action: 'repDone', arg: 'r1', off: true }]],
    };
    // Чужая организация: строки журнала не видно (RLS), и функция сохранения её не трогает.
    const seen = await withOrgContext(t.app.db, ctxB(), (tx) =>
      tx
        .select({ id: telegramOutbox.id })
        .from(telegramOutbox)
        .where(eq(telegramOutbox.id, row.id)),
    );
    expect(seen).toEqual([]);
    expect(
      await withOrgContext(t.app.db, ctxB(), (tx) => saveBotPress(tx, row.id, 7001, pressed)),
    ).toBe(false);
    // Свой, но другой чат — тоже нет; без пользователя в контексте — нет.
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) => saveBotPress(tx, row.id, 7002, pressed)),
    ).toBe(false);
    expect(
      await withOrgContext(t.app.db, { orgId: a.orgId }, (tx) =>
        saveBotPress(tx, row.id, 7001, pressed),
      ),
    ).toBe(false);
    expect((await botPressTarget(t.app.db, 7001, 301))!.message).toEqual(message);
    // Взять сообщение на обработку нажатия может тоже только получатель из своего чата.
    expect(
      await withOrgContext(t.app.db, ctxB(), (tx) => lockBotPress(tx, row.id, 7001)),
    ).toBeNull();
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) => lockBotPress(tx, row.id, 7002)),
    ).toBeNull();
    expect(
      await withOrgContext(t.app.db, { orgId: a.orgId }, (tx) => lockBotPress(tx, row.id, 7001)),
    ).toBeNull();
    expect(await withOrgContext(t.app.db, ctxA(), (tx) => lockBotPress(tx, row.id, 7001))).toEqual(
      message,
    );

    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) => saveBotPress(tx, row.id, 7001, pressed)),
    ).toBe(true);
    expect(await withOrgContext(t.app.db, ctxA(), (tx) => lockBotPress(tx, row.id, 7001))).toEqual(
      pressed,
    );
    expect((await botPressTarget(t.app.db, 7001, 301))!.message).toEqual(pressed);
    // Напрямую описание сообщения роль приложения не меняет — только функцией.
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) =>
        tx.update(telegramOutbox).set({ payload: message }).where(eq(telegramOutbox.id, row.id)),
      ),
    ).rejects.toEqual(permissionDenied);
  });

  it('очередь: сообщение с кнопками отдаётся с описанием и видом получателя, номер в чате запоминается', async () => {
    const now = new Date();
    const [id] = await withOrgContext(t.app.db, ctxA(), (tx) =>
      enqueueTelegram(
        tx,
        [{ userId: a.ownerUserId, chatId: 7001, kind: 'bot_test', text: 'Сегодня срок', message }],
        now,
      ),
    );
    const claimed = await withOrgContext(t.app.db, ctxA(), (tx) =>
      claimOutbox(tx, { now, limit: 10, leaseSeconds: 120, ids: [id!] }),
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id, message, plain: false });
    // До отправки по сообщению очереди нажатие не принимается: номера в чате ещё нет.
    expect(await botPressTarget(t.app.db, 7001, 401)).toBeNull();
    await withOrgContext(t.app.db, ctxA(), (tx) =>
      finishOutbox(tx, [{ id: id!, result: 'sent', at: now, messageId: 401 }]),
    );
    expect(await botPressTarget(t.app.db, 7001, 401)).toMatchObject({ outboxId: id, message });
  });

  it('«Сообщения простым текстом»: свой переключатель, прежнее значение, хранится у пользователя', async () => {
    expect(await telegramPlainText(t.app.db, a.ownerUserId)).toBe(false);
    expect(await withOrgContext(t.app.db, ctxA(), (tx) => setTelegramPlainText(tx, true))).toBe(
      false,
    );
    expect(await withOrgContext(t.app.db, ctxA(), (tx) => setTelegramPlainText(tx, true))).toBe(
      true,
    );
    expect(await telegramPlainText(t.app.db, a.ownerUserId)).toBe(true);
    // Чужая настройка не меняется, у пользователя без Telegram — пусто.
    expect(await telegramPlainText(t.app.db, b.ownerUserId)).toBe(false);
    expect(
      await withUserContext(t.app.db, adminId, (tx) => setTelegramPlainText(tx, true)),
    ).toBeNull();
    expect(await telegramPlainText(t.app.db, adminId)).toBe(false);
    // Очередь отдаёт вид получателя вместе с сообщением.
    const now = new Date();
    const [id] = await withOrgContext(t.app.db, ctxA(), (tx) =>
      enqueueTelegram(
        tx,
        [{ userId: a.ownerUserId, chatId: 7001, kind: 'bot_test', text: 'Текстом', message }],
        now,
      ),
    );
    const claimed = await withOrgContext(t.app.db, ctxA(), (tx) =>
      claimOutbox(tx, { now, limit: 10, leaseSeconds: 120, ids: [id!] }),
    );
    expect(claimed[0]).toMatchObject({ plain: true });
    await withOrgContext(t.app.db, ctxA(), (tx) =>
      finishOutbox(tx, [{ id: id!, result: 'sent', at: now, messageId: 501 }]),
    );

    // Настройка — у пользователя, как в прототипе: другой чат её не сбрасывает.
    await t.admin.db
      .update(telegramLinks)
      .set({ chatId: 7011 })
      .where(eq(telegramLinks.userId, a.ownerUserId));
    expect(await telegramPlainText(t.app.db, a.ownerUserId)).toBe(true);
    // Сообщение прежнего чата больше не «привязано»: нажатие из него бот не примет.
    expect(await botPressTarget(t.app.db, 7001, 201)).toMatchObject({ linked: false });
    await t.admin.db
      .update(telegramLinks)
      .set({ chatId: 7001 })
      .where(eq(telegramLinks.userId, a.ownerUserId));
    expect(await botPressTarget(t.app.db, 7001, 201)).toMatchObject({ linked: true });
    expect(await withOrgContext(t.app.db, ctxA(), (tx) => setTelegramPlainText(tx, false))).toBe(
      true,
    );
    expect(await telegramPlainText(t.app.db, a.ownerUserId)).toBe(false);
  });

  it('история «через Telegram»: отметка ставится только в помеченной транзакции, значение проверяет база', async () => {
    const write = (via: boolean) =>
      withOrgContext(t.app.db, ctxA(), async (tx) => {
        if (via) await markViaTelegram(tx);
        await writeHistory(tx, {
          entity: 'user',
          entityId: a.ownerUserId,
          action: 'update',
          changes: [{ field: 'botMark', to: via }],
        });
        await writeStatusChange(tx, {
          scale: 'report',
          entityId: a.ownerUserId,
          from: null,
          to: via ? 'in_progress' : 'todo',
        });
      });
    await write(true);
    await write(false);
    const history = await t.admin.db
      .select({ via: auditLog.via })
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, a.ownerUserId)))
      .orderBy(desc(auditLog.id))
      .limit(2);
    expect(history.map((h) => h.via)).toEqual([null, 'telegram']);
    const statuses = await t.admin.db
      .select({ via: statusHistory.via })
      .from(statusHistory)
      .where(eq(statusHistory.entityId, a.ownerUserId))
      .orderBy(desc(statusHistory.id))
      .limit(2);
    expect(statuses.map((s) => s.via)).toEqual([null, 'telegram']);
    // Другое значение отметки база не принимает.
    await expect(
      withOrgContext(t.app.db, ctxA(), async (tx) => {
        await tx.execute(sql`select set_config('app.via', 'site', true)`);
        await writeHistory(tx, { entity: 'user', entityId: a.ownerUserId, action: 'update' });
      }),
    ).rejects.toThrow();
  });

  it('«Сообщения с таблицами» платформы: меняет только администратор платформы, с записью в историю', async () => {
    expect(await telegramBotRich(t.app.db)).toBe(true);
    // Сотрудник организации — пусто, настройка не меняется.
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) => adminSetTelegramBotRich(tx, false)),
    ).toBeNull();
    expect(await telegramBotRich(t.app.db)).toBe(true);
    expect(
      await withUserContext(t.app.db, adminId, (tx) => adminSetTelegramBotRich(tx, false)),
    ).toBe(true);
    expect(await telegramBotRich(t.app.db)).toBe(false);
    // Организация настройку читает (по ней выбирается вид сообщения).
    expect(await withOrgContext(t.app.db, ctxA(), (tx) => telegramBotRich(tx))).toBe(false);
    // Повтор того же значения историю не пишет.
    expect(
      await withUserContext(t.app.db, adminId, (tx) => adminSetTelegramBotRich(tx, false)),
    ).toBe(false);
    expect(
      await withUserContext(t.app.db, adminId, (tx) => adminSetTelegramBotRich(tx, true)),
    ).toBe(false);
    const history = await withUserContext(t.app.db, adminId, (tx) =>
      readPlatformHistory(tx, 'telegram_bot', 'view'),
    );
    expect(history.map((h) => h.changes)).toEqual([
      [{ field: 'rich', from: true, to: false }],
      [{ field: 'rich', from: false, to: true }],
    ]);
  });

  it('отвязанный Telegram: сообщение находится, но чат уже не привязан; вид сообщений остаётся', async () => {
    const row = await logged(b.ownerUserId, 7002, 601);
    expect(await botPressTarget(t.app.db, 7002, 601)).toMatchObject({ linked: true });
    expect(await withOrgContext(t.app.db, ctxB(), (tx) => setTelegramPlainText(tx, true))).toBe(
      false,
    );
    await withOrgContext(t.app.db, ctxB(), (tx) => unlinkTelegram(tx));
    expect(await botPressTarget(t.app.db, 7002, 601)).toMatchObject({
      userId: b.ownerUserId,
      linked: false,
    });
    // Описание сообщения остаётся своим, но принять нажатие по нему бот уже не даст (`linked`).
    expect(await withOrgContext(t.app.db, ctxB(), (tx) => lockBotPress(tx, row.id, 7002))).toEqual(
      message,
    );
    // Выбор вида отвязку переживает (как в прототипе), а менять его без Telegram нельзя.
    expect(await telegramPlainText(t.app.db, b.ownerUserId)).toBe(true);
    expect(
      await withOrgContext(t.app.db, ctxB(), (tx) => setTelegramPlainText(tx, false)),
    ).toBeNull();
    expect(await telegramPlainText(t.app.db, b.ownerUserId)).toBe(true);
  });
});
