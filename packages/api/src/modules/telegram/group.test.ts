import {
  createFakeTelegram,
  fixedClock,
  type FakeTelegram,
  type FixedClock,
} from '@buhuchet/adapters';
import { createManualReport, schema, withOrgContext } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { TELEGRAM_TEMPLATE_DEFAULTS, type IsoDate } from '@buhuchet/domain';
import { and, eq } from 'drizzle-orm';
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
import { telegramRemindersJob } from './reminders';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type App = ReturnType<typeof createApp>;

const TPL = TELEGRAM_TEMPLATE_DEFAULTS;
const SITE = 'https://stand.example';
const noPause = async () => {};
const CHAT = { owner: 7400, chief: 7401, acc: 7402, senior: 7404, ownerB: 7500, accB: 7501 };
const GROUP = -1_001_000_100;
const OTHER = -1_001_000_200;
const MOVED = -1_001_000_300;
const CP = 'ОсОО «Ала-Тоо Трейд»';
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{([^}]+)\}/g, (_, k: string) => String(values[k] ?? ''));

/** Сообщение в группе — как его присылает Telegram. */
const groupMessage = (chatId: number, text: string) => {
  const update = telegramUpdate(text, chatId, { chatType: 'supergroup', fromId: CHAT.owner });
  return {
    ...update,
    message: { ...update.message, chat: { id: chatId, type: 'supergroup', title: 'Бухгалтерия' } },
  };
};
/** Группа стала супергруппой: служебное сообщение в прежней группе с её новым номером. */
const migrated = (chatId: number, to: number) => ({
  update_id: 990_002,
  message: {
    message_id: 1,
    date: 1_792_972_800,
    chat: { id: chatId, type: 'group', title: 'Бухгалтерия' },
    from: { id: CHAT.owner, is_bot: false, first_name: 'Тест' },
    migrate_to_chat_id: to,
  },
});
const botRemoved = (chatId: number) => ({
  update_id: 990_001,
  my_chat_member: {
    chat: { id: chatId, type: 'supergroup', title: 'Бухгалтерия' },
    from: { id: CHAT.owner, is_bot: false, first_name: 'Тест' },
    date: 1_792_972_800,
    old_chat_member: { status: 'member', user: { id: 1, is_bot: true, first_name: 'Бот' } },
    new_chat_member: { status: 'kicked', user: { id: 1, is_bot: true, first_name: 'Бот' } },
  },
});

// Общий рабочий чат фирмы (поток Т, задача Т8; пакет заказчика 13.11.2026, идея 11; прототип v105
// modules/tg-group.js). Понедельник, 19.10.2026, 09:00 по Бишкеку.
describe.skipIf(!databaseAvailable())('Общий чат фирмы в Telegram (Т8)', () => {
  let f: Fixture;
  let tg: FakeTelegram;
  let clock: FixedClock;
  let deps: ApiDeps;
  let app: App;
  const cookies: Record<string, string> = {};
  let token = '';

  const person = (login: string) => f.people[login]!;
  const sent = (chatId: number) =>
    tg.sent.map((m, i) => ({ ...m, id: tg.messageIds[i]! })).filter((m) => m.chatId === chatId);
  const group = async (login = 'owner-a') => {
    const res = await apiRequest(app, 'GET', '/api/telegram/group', cookies[login]);
    expect(res.status).toBe(200);
    return (await res.json()) as {
      group: {
        title: string;
        linkedByName: string | null;
        summary: boolean;
        gone: boolean;
        version: number;
      } | null;
      canEdit: boolean;
      bot: boolean;
      time: string;
    };
  };
  const newLink = async (login = 'owner-a') => {
    const res = await apiRequest(app, 'POST', '/api/telegram/group/link', cookies[login]);
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    return new URL(url).searchParams.get('startgroup')!;
  };
  const start = (chatId: number, payload: string, bot = 'buhuchet_test_bot') =>
    sendToBot(app, groupMessage(chatId, `/start@${bot} ${payload}`));
  const settings = (orgId: string, features: Record<string, boolean>) =>
    f.t.admin.db
      .update(schema.orgSettings)
      .set({ features })
      .where(eq(schema.orgSettings.orgId, orgId));
  const FEATURES = { telegram: true, tasks: true, taxpay: true };

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    tg = createFakeTelegram();
    clock = fixedClock('2026-10-19T03:00:00Z');
    deps = createTestDeps({ db: f.t.app.db, telegram: tg, clock });
    app = createApp(deps);
    await settings(f.a.orgId, FEATURES);
    await settings(f.b.orgId, FEATURES);
    for (const [login, chat] of [
      ['owner-a', CHAT.owner],
      ['chief-a', CHAT.chief],
      ['acc-a', CHAT.acc],
      ['senior-a', CHAT.senior],
      ['owner-b', CHAT.ownerB],
      ['acc-b', CHAT.accB],
    ] as const) {
      cookies[login] = await signIn(app, login, TEST_PASSWORD);
      await linkTelegram(app, cookies[login]!, chat);
    }
    const [cp] = await f.t.admin.db
      .insert(schema.contractors)
      .values({
        orgId: f.a.orgId,
        name: CP,
        inn: '03744097401851',
        phone: '+996505890076',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        startDate: '2026-07-01',
        feeDay: 15,
        paysTo: 'org',
        createdAt: new Date('2026-06-20T10:00:00+06:00'),
        responsibleEmployeeId: person('acc-a').employeeId,
      })
      .returning({ id: schema.contractors.id });
    // Бухгалтер: 1-Т сдать сегодня, НДС просрочен.
    for (const [type, month, due] of [
      ['t1m', '2026-09-01', '2026-10-19'],
      ['nds', '2026-08-01', '2026-10-14'],
    ] as const) {
      const { id } = await withOrgContext(
        f.t.app.db,
        { orgId: f.a.orgId, userId: f.a.ownerUserId },
        (tx) =>
          createManualReport(
            tx,
            {
              contractorId: cp!.id,
              reportTypeCode: type,
              month,
              eventDate: null,
              due: '2026-10-22',
              reasonCode: 'ПРЧ-001',
              reasonName: 'Продление от госоргана',
            },
            { today: clock.today(), scope: undefined },
          ),
      );
      await f.t.admin.db
        .update(schema.reports)
        .set({ dueDate: due as IsoDate })
        .where(eq(schema.reports.id, id));
    }
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('видят все сотрудники, подключает только владелец; выключенный Telegram и бот без настроек — отказ', async () => {
    expect(await group('acc-a')).toEqual({ group: null, canEdit: false, bot: true, time: '09:00' });
    expect((await group()).canEdit).toBe(true);
    // Бухгалтер без права «Настройки и учётная политика».
    expect(
      (await apiRequest(app, 'POST', '/api/telegram/group/link', cookies['acc-a'])).status,
    ).toBe(403);
    // Право «Настройки и учётная политика» выдать не владельцу нельзя: всё равно отказ.
    await f.t.admin.db.insert(schema.rolePermissions).values({
      orgId: f.a.orgId,
      roleId: f.templateRole(f.a, 'chief'),
      permissionId: 'org',
    });
    const chief = await apiRequest(app, 'POST', '/api/telegram/group/link', cookies['chief-a']);
    expect(chief.status).toBe(403);
    await settings(f.a.orgId, { ...FEATURES, telegram: false });
    const off = await apiRequest(app, 'POST', '/api/telegram/group/link', cookies['owner-a']);
    expect(off.status).toBe(403);
    expect(((await off.json()) as { error: { code: string } }).error.code).toBe('telegram_off');
    await settings(f.a.orgId, FEATURES);
    const noBot = createApp({ ...deps, telegram: null });
    expect(
      (await apiRequest(noBot, 'POST', '/api/telegram/group/link', cookies['owner-a'])).status,
    ).toBe(503);
    expect((await apiRequest(app, 'GET', '/api/telegram/group')).status).toBe(401);
  });

  it('группа подключается одноразовой ссылкой; неверная ссылка — отказ и выход; повтор — без ответа', async () => {
    token = await newLink();
    expect(token).toMatch(/^g_[A-Za-z0-9_-]{43}$/);
    // Команда другому боту — не наша.
    expect((await start(GROUP, token, 'other_bot')).status).toBe(200);
    expect(sent(GROUP)).toHaveLength(0);
    expect((await start(GROUP, token)).status).toBe(200);
    expect(sent(GROUP).map((m) => m.text)).toEqual([
      fill(TPL.tgGrpLinked, { группа: 'Бухгалтерия', организация: 'Организация А' }),
    ]);
    // Telegram повторил доставку — второй раз бот не отвечает.
    await start(GROUP, token);
    expect(sent(GROUP)).toHaveLength(1);
    const g = await group();
    expect(g.group).toMatchObject({ title: 'Бухгалтерия', summary: true, gone: false });
    expect(g.group!.linkedByName).toBeTruthy();
    // Та же ссылка в другой группе и ключ не той формы — отказ, бот выходит из ничьей группы.
    await start(OTHER, token);
    await start(OTHER, 'g_abc');
    expect(sent(OTHER).map((m) => m.text)).toEqual([TPL.tgGrpLinkBad, TPL.tgGrpLinkBad]);
    expect(tg.left).toEqual([OTHER, OTHER]);
    // Ссылка организации Б в группе организации А — отказ, бот остаётся (группа нужна А).
    const tokenB = await newLink('owner-b');
    await start(GROUP, tokenB);
    expect(sent(GROUP).at(-1)!.text).toBe(TPL.tgGrpLinkBad);
    expect(tg.left).not.toContain(GROUP);
    expect((await group('owner-b')).group).toBeNull();
  });

  it('сводка дня — только числа и имена; «Мои» — скрытым сообщением нажавшему', async () => {
    await telegramRemindersJob(SITE, noPause).run(deps, clock.now());
    const summary = sent(GROUP).at(-1)!;
    const text = summary.text + (summary.options.rich ?? '');
    expect(text).toContain(fill(TPL.tgGrpSub, { сегодня: 1, просрочено: 1, ждут: 0 }));
    expect(text).toContain('acc-a');
    expect(text).not.toContain('Ала-Тоо');
    expect((summary.options.keyboard ?? []).flat().map((b) => b.text)).toEqual([TPL.tgBtnGrpMine]);
    // Повторный запуск в тот же день — без второй сводки.
    const before = tg.sent.length;
    await telegramRemindersJob(SITE, noPause).run(deps, clock.now());
    expect(tg.sent).toHaveLength(before);

    const data = (summary.options.keyboard ?? []).flat()[0]!.data!;
    const pressMine = async (fromId: number) => {
      const res = await sendToBot(
        app,
        telegramPress(data, GROUP, summary.id, { chatType: 'supergroup', fromId }),
      );
      expect(res.status).toBe(200);
      return tg.answers.at(-1)!;
    };
    const answer = await pressMine(CHAT.acc);
    expect(answer).toMatchObject({ text: TPL.tgGrpMineToast, alert: false });
    const mine = sent(GROUP).at(-1)!;
    expect(mine.options.ephemeral).toEqual({
      receiverUserId: CHAT.acc,
      callbackQueryId: answer.callbackId,
    });
    expect(mine.options.rich ?? mine.text).toContain('Ала-Тоо');
    expect(mine.text).toContain(fill(TPL.tgGrpMineHead, { сегодня: 1, просрочено: 1 }));
    // Владельцу сдавать нечего.
    await pressMine(CHAT.owner);
    expect(sent(GROUP).at(-1)!).toMatchObject({
      text: TPL.tgGrpMineNone,
      options: { ephemeral: { receiverUserId: CHAT.owner } },
    });
    // Не привязан к организации группы (другая организация и ничей Telegram) — отказ окном.
    const count = sent(GROUP).length;
    expect(await pressMine(CHAT.accB)).toMatchObject({ text: TPL.tgGrpNoLink, alert: true });
    expect(await pressMine(9_999)).toMatchObject({ text: TPL.tgGrpNoLink, alert: true });
    // Без права «Просматривать отчёты».
    expect(await pressMine(CHAT.senior)).toMatchObject({ text: TPL.tgActNoRight, alert: true });
    // Заблокированный сотрудник.
    await f.t.admin.db
      .update(schema.employees)
      .set({ active: false })
      .where(eq(schema.employees.id, person('chief-a').employeeId));
    expect(await pressMine(CHAT.chief)).toMatchObject({ text: TPL.tgActNoRight, alert: true });
    // Не «Мои» — ядро нажатий молча отклоняет, как любое нажатие в группе.
    await sendToBot(
      app,
      telegramPress('tsDone:x', GROUP, summary.id, { chatType: 'supergroup', fromId: CHAT.acc }),
    );
    expect(tg.answers.at(-1)).toMatchObject({ text: undefined });
    expect(sent(GROUP)).toHaveLength(count);
  });

  it('сводка выключена — в группу ничего; новый номер группы, отключение — бот пишет и выходит', async () => {
    const g = (await group()).group!;
    const stale = await apiRequest(app, 'PUT', '/api/telegram/group', cookies['owner-a'], {
      version: g.version + 3,
      summary: false,
    });
    expect(stale.status).toBe(409);
    const accPut = await apiRequest(app, 'PUT', '/api/telegram/group', cookies['acc-a'], {
      version: g.version,
      summary: false,
    });
    expect(accPut.status).toBe(403);
    const put = await apiRequest(app, 'PUT', '/api/telegram/group', cookies['owner-a'], {
      version: g.version,
      summary: false,
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { group: { summary: boolean } }).group.summary).toBe(false);
    clock.set('2026-10-20T03:00:00Z');
    const before = sent(GROUP).length;
    await telegramRemindersJob(SITE, noPause).run(deps, clock.now());
    expect(sent(GROUP)).toHaveLength(before);
    expect(sent(CHAT.acc).length).toBeGreaterThan(0);

    // Группа стала супергруппой — у неё новый номер.
    await sendToBot(app, migrated(GROUP, MOVED));
    const [row] = await f.t.admin.db
      .select({ chatId: schema.telegramGroups.chatId })
      .from(schema.telegramGroups)
      .where(eq(schema.telegramGroups.orgId, f.a.orgId));
    expect(row!.chatId).toBe(MOVED);
    // Организация Б не видит и не отключает группу А.
    expect((await group('owner-b')).group).toBeNull();
    const now = (await group()).group!;
    expect(
      (
        await apiRequest(app, 'POST', '/api/telegram/group/unlink', cookies['owner-b'], {
          version: now.version,
        })
      ).status,
    ).toBe(404);
    const off = await apiRequest(app, 'POST', '/api/telegram/group/unlink', cookies['owner-a'], {
      version: now.version,
    });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { group: unknown }).group).toBeNull();
    expect(sent(MOVED).at(-1)!.text).toBe(TPL.tgGrpOff);
    expect(tg.left).toContain(MOVED);
  });

  it('бота удалили из группы — сводки прекращаются, «Забыть группу» без сообщения', async () => {
    const t2 = await newLink();
    await start(OTHER, t2);
    expect((await group()).group).toMatchObject({ gone: false });
    await sendToBot(app, botRemoved(OTHER));
    const g = (await group()).group!;
    expect(g.gone).toBe(true);
    // Повтор «удалили» — без второй записи.
    await sendToBot(app, botRemoved(OTHER));
    expect((await group()).group!.version).toBe(g.version);
    const before = tg.sent.length;
    const left = tg.left.length;
    const off = await apiRequest(app, 'POST', '/api/telegram/group/unlink', cookies['owner-a'], {
      version: g.version,
    });
    expect(off.status).toBe(200);
    expect(tg.sent).toHaveLength(before);
    expect(tg.left).toHaveLength(left);
    const fields = (
      await f.t.admin.db
        .select({ changes: schema.auditLog.changes })
        .from(schema.auditLog)
        .where(
          and(eq(schema.auditLog.entity, 'org_settings'), eq(schema.auditLog.entityId, f.a.orgId)),
        )
        .orderBy(schema.auditLog.id)
    )
      .flatMap((r) => r.changes.map((c) => c.field))
      .filter((x) => x.startsWith('telegramGroup'));
    expect(fields).toEqual([
      'telegramGroup',
      'telegramGroupSummary',
      'telegramGroup',
      'telegramGroup',
      'telegramGroupGone',
      'telegramGroup',
    ]);
  });
});
