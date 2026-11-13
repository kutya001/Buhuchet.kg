import {
  createFakeTelegram,
  fixedClock,
  type FakeTelegram,
  type FixedClock,
} from '@buhuchet/adapters';
import { schema, startSession } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  botPressData,
  fillTemplate,
  NOT_ME_ACTION,
  NOT_ME_HOURS,
  notMeArg,
  TELEGRAM_TEMPLATE_DEFAULTS,
  UI_TEXTS,
  type SecurityNotice,
} from '@buhuchet/domain';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  linkTelegram,
  sendToBot,
  signIn,
  telegramPress,
  telegramUpdate,
  TEST_PASSWORD,
} from '../../testing';
import { sendBotMessage, sendSecurityNotice } from './bot';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type App = ReturnType<typeof createApp>;

const TPL = TELEGRAM_TEMPLATE_DEFAULTS;
const START = '2026-11-14T03:15:27Z';
const NEW_PASSWORD = 'Новый-пароль-2';
const CHAT = { owner: 7400, acc: 7401, chief: 7402, chiefNew: 7403, ownerB: 7500, admin: 7900 };
const codeOf = (text: string | undefined) => /^(\d{6}) — код/m.exec(text ?? '')?.[1] ?? '';

// «Это не я» под сообщениями бота о безопасности (поток Т, задача Т4; пакет заказчика 13.11.2026,
// идея 9; прототип v101 modules/tg-security.js). 14.11.2026, 09:15 по Бишкеку.
describe.skipIf(!databaseAvailable())(
  '«Это не я» под сообщениями о безопасности: сеансы завершены, вход закрыт (Т4)',
  () => {
    let f: Fixture;
    let tg: FakeTelegram;
    let clock: FixedClock;
    let deps: ApiDeps;
    let app: App;
    let adminId = '';

    const person = (login: string) => f.people[login]!;
    const sent = (chatId: number) =>
      tg.sent.map((m, i) => ({ ...m, id: tg.messageIds[i]! })).filter((m) => m.chatId === chatId);
    const last = (chatId: number) => sent(chatId).at(-1)!;
    const keys = (m: { options: FakeTelegram['sent'][number]['options'] }) =>
      (m.options.keyboard ?? []).flat();
    const data = (notice: SecurityNotice, at = clock.now()) =>
      botPressData(NOT_ME_ACTION, notMeArg(notice, at));
    const press = async (chatId: number, messageId: number, pressed: string) => {
      const res = await sendToBot(app, telegramPress(pressed, chatId, messageId));
      expect(res.status).toBe(200);
      return tg.answers.at(-1)!;
    };
    const user = async (userId: string) =>
      (await f.t.admin.db.select().from(schema.users).where(eq(schema.users.id, userId)))[0]!;
    const sessions = (userId: string) =>
      f.t.admin.db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId));
    const login = (name: string, password: string) =>
      apiRequest(app, 'POST', '/api/auth/login', undefined, { login: name, password });
    const setPassword = async (userId: string) => {
      const [own] = await f.t.admin.db
        .select({ hash: schema.users.passwordHash })
        .from(schema.users)
        .where(eq(schema.users.id, f.a.ownerUserId));
      // Вход открыт, пароль — как у владельца (TEST_PASSWORD): состояние до нажатия.
      await f.t.admin.db
        .update(schema.users)
        .set({
          passwordHash: own!.hash,
          mustChangePassword: false,
          loginLockedAt: null,
          loginLockReason: null,
        })
        .where(eq(schema.users.id, userId));
      await f.t.admin.db
        .delete(schema.telegramLinkGuards)
        .where(eq(schema.telegramLinkGuards.userId, userId));
    };
    /** Сообщение о безопасности получателю — как его отправил бы бот; возвращает сообщение в чате. */
    const notice = async (
      userId: string,
      chatId: number,
      name: string,
      orgName: string | null = 'Организация А',
    ) => {
      expect(
        await sendSecurityNotice(
          deps,
          { userId, chatId, shared: false, orgName },
          'pass',
          { логин: name },
          't',
        ),
      ).toBe(true);
      return last(chatId);
    };
    const history = (userId: string) =>
      f.t.admin.db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entityId, userId), eq(schema.auditLog.action, 'not_me')))
        .orderBy(desc(schema.auditLog.id));

    beforeAll(async () => {
      f = await createStaffFixture();
      tg = createFakeTelegram();
      clock = fixedClock(START);
      deps = createTestDeps({ db: f.t.app.db, telegram: tg, clock });
      app = createApp(deps);
      for (const [name, chat] of [
        ['owner-a', CHAT.owner],
        ['acc-a', CHAT.acc],
        ['chief-a', CHAT.chief],
        ['owner-b', CHAT.ownerB],
      ] as const) {
        await linkTelegram(app, await signIn(app, name, TEST_PASSWORD), chat);
      }
      const [admin] = await f.t.admin.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.isPlatformAdmin, true));
      adminId = admin!.id;
      await f.t.admin.db
        .insert(schema.telegramLinks)
        .values({ userId: adminId, orgId: null, chatId: CHAT.admin });
      // Кнопка — защита учётной записи: выключатель «Действия из Telegram» на неё не влияет.
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({ telegramActions: false })
        .where(eq(schema.orgSettings.orgId, f.a.orgId));
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('«Пароль изменён»: под сообщением кнопка; нажатие завершает сеансы, закрывает вход, владельцу — сообщение', async () => {
      const acc = person('acc-a');
      const cookie = await signIn(app, 'acc-a', TEST_PASSWORD);
      const other = await signIn(app, 'acc-a', TEST_PASSWORD);
      const changed = await apiRequest(app, 'POST', '/api/auth/password', cookie, {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      expect(changed.status).toBe(200);
      const m = last(CHAT.acc);
      expect(m.text).toBe(fillTemplate(TPL.tgPassChanged, { логин: 'acc-a', время: '09:15' }));
      expect(keys(m)).toEqual([{ text: TPL.tgBtnNotMe, data: data('pass') }]);
      // Смена пароля закрыла прочие сеансы; тот, кто сменил пароль, остался в программе.
      expect((await apiRequest(app, 'GET', '/api/auth/me', other)).status).toBe(401);
      const fresh = changed.headers.get('set-cookie')!.split(';')[0]!;
      expect((await apiRequest(app, 'GET', '/api/auth/me', fresh)).status).toBe(200);

      // Подставить другой момент отправки нельзя: такой кнопки в сообщении нет.
      const forged = await press(CHAT.acc, m.id, data('pass', new Date('2030-01-01T00:00:00Z')));
      expect(forged).toMatchObject({ text: TPL.tgActStale, alert: true });
      // Из чужого чата это сообщение не найти.
      expect(await press(CHAT.owner, m.id, data('pass'))).toMatchObject({ text: TPL.tgActStale });
      expect((await user(acc.userId)).loginLockedAt).toBeNull();

      const answer = await press(CHAT.acc, m.id, data('pass'));
      expect(answer.text).toBeUndefined();
      expect(tg.edits.at(-1)).toMatchObject({ chatId: CHAT.acc, messageId: m.id });
      expect(tg.edits.at(-1)!.keyboard.flat()).toEqual([
        expect.objectContaining({ text: UI_TEXTS['telegram.done.not_me'].ru }),
      ]);
      expect((await apiRequest(app, 'GET', '/api/auth/me', fresh)).status).toBe(401);
      expect(await sessions(acc.userId)).toHaveLength(0);
      expect(await user(acc.userId)).toMatchObject({ loginLockReason: 'not_me' });
      // Ответ бота — обычное сообщение в тот же чат; чат остаётся привязанным.
      expect(last(CHAT.acc).text).toBe(
        fillTemplate(TPL.tgNotMeDone, { логин: 'acc-a', кто: 'владелец организации' }),
      );
      // Владельцу организации — сразу; администратору платформы и чужой организации — ничего.
      expect(last(CHAT.owner).text).toBe(
        fillTemplate(TPL.tgNotMeStaff, { логин: 'acc-a', событие: 'пароль изменён' }),
      );
      expect(sent(CHAT.admin)).toHaveLength(0);
      expect(sent(CHAT.ownerB)).toHaveLength(1);
      // История учётной записи — от имени нажавшего, «через Telegram».
      const [entry] = await history(acc.userId);
      expect(entry).toMatchObject({
        orgId: f.a.orgId,
        entity: 'user',
        actorUserId: acc.userId,
        via: 'telegram',
        changes: [
          { field: 'notMe', to: 'pass' },
          { field: 'sessionsEnded', to: '1' },
          { field: 'loginLocked', from: false, to: true },
        ],
      });

      // Страница входа: свой текст — только после верного пароля; «Забыли пароль?» код не присылает.
      const wrong = await login('acc-a', 'Не-тот-пароль-9');
      expect(wrong.status).toBe(401);
      const denied = await login('acc-a', NEW_PASSWORD);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({
        error: {
          code: 'account_locked',
          message: UI_TEXTS['err.account_locked.not_me'].ru,
          details: { variant: 'not_me' },
        },
      });
      const before = tg.sent.length;
      expect(
        (await apiRequest(app, 'POST', '/api/auth/password-reset', undefined, { login: 'acc-a' }))
          .status,
      ).toBe(200);
      expect(tg.sent).toHaveLength(before);

      // Вход уже закрыт — второе нажатие (кнопка новая, сообщение свежее) ничего не делает.
      const again = await notice(acc.userId, CHAT.acc, 'acc-a');
      expect(await press(CHAT.acc, again.id, keys(again)[0]!.data!)).toMatchObject({
        text: TPL.tgActStale,
        alert: true,
      });
      expect(await history(acc.userId)).toHaveLength(1);
    });

    it('новый пароль от владельца открывает вход; с временным паролем кнопка устарела', async () => {
      const acc = person('acc-a');
      const active = last(CHAT.acc);
      const owner = await signIn(app, 'owner-a', TEST_PASSWORD);
      const reset = await apiRequest(
        app,
        'POST',
        `/api/staff/${acc.employeeId}/password-reset`,
        owner,
        {},
      );
      expect(reset.status).toBe(200);
      const { temporaryPassword } = (await reset.json()) as { temporaryPassword: string };
      expect(await user(acc.userId)).toMatchObject({ loginLockedAt: null, loginLockReason: null });
      expect((await login('acc-a', temporaryPassword)).status).toBe(200);
      // Под «Пароль сброшен» кнопки нет.
      expect(keys(last(CHAT.acc))).toEqual([]);
      // Пароль сброшен: прежняя кнопка «Это не я» вход заново не закроет.
      expect(await press(CHAT.acc, active.id, keys(active)[0]!.data!)).toMatchObject({
        text: TPL.tgActStale,
        alert: true,
      });
      expect((await user(acc.userId)).loginLockedAt).toBeNull();
      expect(await sessions(acc.userId)).toHaveLength(1);
      await setPassword(acc.userId);
    });

    it(`кнопка действует ${NOT_ME_HOURS} часа: позже — совет попросить сброс пароля, вход не закрыт`, async () => {
      const acc = person('acc-a');
      const m = await notice(acc.userId, CHAT.acc, 'acc-a');
      const pressed = keys(m)[0]!.data!;
      clock.advance(NOT_ME_HOURS * 3600_000 + 1000);
      expect(await press(CHAT.acc, m.id, pressed)).toMatchObject({
        text: fillTemplate(TPL.tgActNotMeLate, { часов: NOT_ME_HOURS }),
        alert: true,
      });
      expect((await user(acc.userId)).loginLockedAt).toBeNull();
      clock.set(START);
      // Ровно в срок кнопка ещё действует.
      clock.advance(NOT_ME_HOURS * 3600_000);
      expect((await press(CHAT.acc, m.id, pressed)).text).toBeUndefined();
      expect((await user(acc.userId)).loginLockReason).toBe('not_me');
      clock.set(START);
      await setPassword(acc.userId);
    });

    it('«Привязан другой Telegram»: кнопка в прежнем чате; другой Telegram отвязан, прежний чат обратно не привязывается', async () => {
      const chief = person('chief-a');
      const cookie = await signIn(app, 'chief-a', TEST_PASSWORD);
      // Другой чат вместо прежнего — по коду из прежнего.
      await linkTelegram(app, cookie, CHAT.chiefNew, 'stranger');
      await sendToBot(app, telegramUpdate(codeOf(last(CHAT.chief).text), CHAT.chiefNew));
      const m = last(CHAT.chief);
      expect(m.text).toBe(
        fillTemplate(TPL.tgRelinked, { логин: 'chief-a', телеграм: '@stranger' }),
      );
      expect(keys(m)).toEqual([{ text: TPL.tgBtnNotMe, data: data('relink') }]);

      // Обычная кнопка в прежнем, уже не привязанном чате не действует.
      await sendBotMessage(
        deps,
        { userId: chief.userId, chatId: CHAT.chief },
        { text: 'Проверка', buttons: [[{ text: 'Проверить', action: 'test' }]] },
        'bot_test',
        't',
      );
      const plain = last(CHAT.chief);
      expect(await press(CHAT.chief, plain.id, botPressData('test', null))).toMatchObject({
        text: TPL.tgActStale,
      });

      expect((await press(CHAT.chief, m.id, data('relink'))).text).toBeUndefined();
      expect(await user(chief.userId)).toMatchObject({ loginLockReason: 'not_me' });
      expect((await apiRequest(app, 'GET', '/api/auth/me', cookie)).status).toBe(401);
      expect(
        await f.t.admin.db
          .select()
          .from(schema.telegramLinks)
          .where(eq(schema.telegramLinks.userId, chief.userId)),
      ).toEqual([]);
      const [guard] = await f.t.admin.db
        .select()
        .from(schema.telegramLinkGuards)
        .where(eq(schema.telegramLinkGuards.userId, chief.userId));
      expect(guard).toMatchObject({ chatId: CHAT.chief, freeUntil: null });
      expect(last(CHAT.chief).text).toBe(
        fillTemplate(TPL.tgNotMeDone, { логин: 'chief-a', кто: 'владелец организации' }),
      );
      expect(last(CHAT.owner).text).toBe(
        fillTemplate(TPL.tgNotMeStaff, { логин: 'chief-a', событие: 'привязан другой Telegram' }),
      );
      // В чат постороннего бот об этом не пишет.
      expect(last(CHAT.chiefNew).text).toBe(fillTemplate(TPL.tgLinked, { логин: 'chief-a' }));
      const [entry] = await history(chief.userId);
      expect(entry!.changes).toEqual([
        { field: 'notMe', to: 'relink' },
        // Сеанс привязки Telegram из подготовки и сеанс этого теста.
        { field: 'sessionsEnded', to: '2' },
        { field: 'telegram', from: '@stranger', to: null },
        { field: 'loginLocked', from: false, to: true },
      ]);
    });

    it('«Telegram отвязан» у владельца: вход закрыт, о владельце — администратору платформы, свой текст входа', async () => {
      const cookie = await signIn(app, 'owner-b', TEST_PASSWORD);
      expect((await apiRequest(app, 'DELETE', '/api/telegram/link', cookie)).status).toBe(200);
      const m = last(CHAT.ownerB);
      expect(m.text).toBe(fillTemplate(TPL.tgUnlinked, { логин: 'owner-b' }));
      expect(keys(m)).toEqual([{ text: TPL.tgBtnNotMe, data: data('unlink') }]);

      expect((await press(CHAT.ownerB, m.id, data('unlink'))).text).toBeUndefined();
      expect(await user(f.b.ownerUserId)).toMatchObject({ loginLockReason: 'not_me' });
      expect(last(CHAT.ownerB).text).toBe(
        fillTemplate(TPL.tgNotMeDone, { логин: 'owner-b', кто: 'администратор платформы' }),
      );
      // Администратору платформы — через очередь, без организации; владельцу организации А — нет.
      const queued = await f.t.admin.db
        .select()
        .from(schema.telegramOutbox)
        .where(
          and(eq(schema.telegramOutbox.kind, 'not_me'), eq(schema.telegramOutbox.userId, adminId)),
        );
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({
        orgId: null,
        chatId: CHAT.admin,
        status: 'pending',
        text: fillTemplate(TPL.tgNotMeOwner, {
          организация: 'Организация Б',
          логин: 'owner-b',
          событие: 'Telegram отвязан',
        }),
      });
      const denied = await login('owner-b', TEST_PASSWORD);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({
        error: {
          code: 'account_locked',
          message: UI_TEXTS['err.account_locked.not_me_owner'].ru,
          details: { variant: 'not_me_owner' },
        },
      });
    });

    it('администратор платформы: сеансы завершены, вход не закрывается, запись — в истории платформы', async () => {
      await startSession(f.t.app.db, { userId: adminId, tokenHash: 'a'.repeat(64) });
      const m = await notice(adminId, CHAT.admin, 'platform-admin', null);
      expect((await press(CHAT.admin, m.id, keys(m)[0]!.data!)).text).toBeUndefined();
      expect(await sessions(adminId)).toHaveLength(0);
      expect(await user(adminId)).toMatchObject({ loginLockedAt: null, loginLockReason: null });
      expect(last(CHAT.admin).text).toBe(
        fillTemplate(TPL.tgNotMeAdmin, { логин: 'platform-admin' }),
      );
      expect(tg.edits.at(-1)!.keyboard.flat()).toEqual([
        expect.objectContaining({ text: UI_TEXTS['telegram.done.not_me_admin'].ru }),
      ]);
      const [entry] = await f.t.admin.db
        .select()
        .from(schema.platformAuditLog)
        .where(
          and(
            eq(schema.platformAuditLog.entityId, adminId),
            eq(schema.platformAuditLog.action, 'not_me'),
          ),
        );
      expect(entry).toMatchObject({
        entity: 'user',
        actorUserId: adminId,
        changes: [
          { field: 'notMe', to: 'pass' },
          { field: 'sessionsEnded', to: '1' },
        ],
      });
    });

    it('заблокированный сотрудник и заблокированная организация — «Нет права», вход не закрывается', async () => {
      const acc = person('acc-a');
      const m = await notice(acc.userId, CHAT.acc, 'acc-a');
      const pressed = keys(m)[0]!.data!;
      const active = (on: boolean) =>
        f.t.admin.db
          .update(schema.employees)
          .set({ active: on })
          .where(eq(schema.employees.id, acc.employeeId));
      await active(false);
      expect(await press(CHAT.acc, m.id, pressed)).toMatchObject({
        text: TPL.tgActNoRight,
        alert: true,
      });
      await active(true);
      const org = (status: 'active' | 'blocked') =>
        f.t.admin.db
          .update(schema.organizations)
          .set({ status })
          .where(eq(schema.organizations.id, f.a.orgId));
      await org('blocked');
      expect(await press(CHAT.acc, m.id, pressed)).toMatchObject({ text: TPL.tgActNoRight });
      await org('active');
      expect((await user(acc.userId)).loginLockedAt).toBeNull();
      // Нажал не хозяин чата — нажатие не принимается вовсе.
      const res = await sendToBot(
        app,
        telegramPress(pressed, CHAT.acc, m.id, { fromId: CHAT.owner }),
      );
      expect(res.status).toBe(200);
      expect((await user(acc.userId)).loginLockedAt).toBeNull();
    });
  },
);
