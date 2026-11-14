import { deflateSync } from 'node:zlib';
import {
  createFakeTelegram,
  fixedClock,
  type FakeTelegram,
  type FixedClock,
} from '@buhuchet/adapters';
import { createManualReport, schema, withOrgContext } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  BOT_WIDGET_HTML_ZIP_MAX,
  TELEGRAM_TEMPLATE_DEFAULTS,
  type IsoDate,
  type WidgetData,
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
  telegramUpdate,
  TEST_PASSWORD,
} from '../../testing';
import { telegramRemindersJob } from './reminders';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type App = ReturnType<typeof createApp>;

const TPL = TELEGRAM_TEMPLATE_DEFAULTS;
const SITE = 'https://stand.example';
const noPause = async () => {};
const CHAT = { owner: 7600, acc: 7602, hr: 7603, senior: 7604, accB: 7701 };
const CP = 'ОсОО «Ала-Тоо Трейд»';
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{([^}]+)\}/g, (_, k: string) => String(values[k] ?? ''));

let queryNo = 0;
/** Запрос виджета к боту — как его присылает Telegram (Bot API 10.4 `widget_query`). */
const widgetQuery = (
  chatId: number,
  messageId: number,
  data: string,
  o: { fromId?: number; chatType?: string } = {},
) => {
  queryNo += 1;
  return {
    update_id: 880_000 + queryNo,
    widget_query: {
      id: `wq-${queryNo}`,
      from: { id: o.fromId ?? chatId, is_bot: false, first_name: 'Тест' },
      chat: { id: chatId, type: o.chatType ?? 'private' },
      message_id: messageId,
      data,
    },
  };
};

// Виджет «Мои отчёты на неделю» (поток Т, задача Т9; пакет заказчика 13.11.2026, идея 5; прототип v106
// modules/tg-widget.js). Понедельник, 19.10.2026, 09:00 по Бишкеку.
describe.skipIf(!databaseAvailable())('Виджет «Мои отчёты на неделю» (Т9)', () => {
  let f: Fixture;
  let tg: FakeTelegram;
  let clock: FixedClock;
  let deps: ApiDeps;
  let app: App;
  let cp = '';
  const cookies: Record<string, string> = {};
  const ids: Record<'nds' | 'today' | 'thu' | 'next', string> = {
    nds: '',
    today: '',
    thu: '',
    next: '',
  };

  const person = (login: string) => f.people[login]!;
  const sent = (chatId: number) => tg.sent.filter((m) => m.chatId === chatId);
  const say = async (chatId: number, text: string) => {
    const res = await sendToBot(app, telegramUpdate(text, chatId));
    expect(res.status).toBe(200);
  };
  const ask = async (...args: Parameters<typeof widgetQuery>) => {
    const update = widgetQuery(...args);
    const before = tg.widgetAnswers.length;
    const res = await sendToBot(app, update);
    expect(res.status).toBe(200);
    expect(tg.widgetAnswers).toHaveLength(before + 1);
    const answer = tg.widgetAnswers.at(-1)!;
    expect(answer.queryId).toBe(update.widget_query.id);
    return answer.data;
  };
  const dataOf = (raw: string) => JSON.parse(raw) as WidgetData;
  const record = async (userId: string) => {
    const [row] = await f.t.admin.db
      .select()
      .from(schema.telegramWidgets)
      .where(eq(schema.telegramWidgets.userId, userId));
    return row;
  };
  const report = async (id: string) => {
    const [row] = await f.t.admin.db.select().from(schema.reports).where(eq(schema.reports.id, id));
    return row!;
  };
  const settings = (patch: Partial<typeof schema.orgSettings.$inferInsert>) =>
    f.t.admin.db
      .update(schema.orgSettings)
      .set(patch)
      .where(eq(schema.orgSettings.orgId, f.a.orgId));
  const needFile = (on: boolean) =>
    f.t.admin.db
      .update(schema.orgReportTypes)
      .set({ needFile: on })
      .where(
        and(
          eq(schema.orgReportTypes.orgId, f.a.orgId),
          eq(schema.orgReportTypes.reportTypeCode, 't1m'),
        ),
      );
  const manual = async (reportTypeCode: string, month: string, due: string) => {
    const { id } = await withOrgContext(
      f.t.app.db,
      { orgId: f.a.orgId, userId: f.a.ownerUserId },
      (tx) =>
        createManualReport(
          tx,
          {
            contractorId: cp,
            reportTypeCode,
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
    return id;
  };
  /** Отправить «/myweek» и вернуть новый виджет чата. */
  const myWeek = async (chatId: number) => {
    const before = tg.widgets.length;
    await say(chatId, '/myweek');
    expect(tg.widgets).toHaveLength(before + 1);
    const w = tg.widgets.at(-1)!;
    expect(w.chatId).toBe(chatId);
    return w;
  };
  /** Номер строки виджета с этим отчётом — по сохранённому списку. */
  const rowOf = async (login: string, reportId: string) =>
    (await record(person(login).userId))!.items.indexOf(reportId);
  /** Номер списка действующего виджета бухгалтера. */
  const v = async () => dataOf((await record(person('acc-a').userId))!.data).v;
  const labelOf = (data: WidgetData, row: number) =>
    `${data.r[row]![2].split(' · ')[0]}, ${data.r[row]![1]}`;

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    tg = createFakeTelegram();
    clock = fixedClock('2026-10-19T03:00:00Z');
    deps = createTestDeps({ db: f.t.app.db, telegram: tg, clock });
    app = createApp(deps);
    for (const orgId of [f.a.orgId, f.b.orgId]) {
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: { telegram: true, tasks: true, files: true }, telegramActions: true })
        .where(eq(schema.orgSettings.orgId, orgId));
    }
    for (const [login, chat] of [
      ['owner-a', CHAT.owner],
      ['acc-a', CHAT.acc],
      ['hr-a', CHAT.hr],
      ['senior-a', CHAT.senior],
      ['acc-b', CHAT.accB],
    ] as const) {
      cookies[login] = await signIn(app, login, TEST_PASSWORD);
      await linkTelegram(app, cookies[login]!, chat);
    }
    const connect = await apiRequest(
      app,
      'POST',
      '/api/org-report-types/connect',
      cookies['owner-a'],
      { connect: ['nds', 't1m'], disconnect: [] },
    );
    expect(connect.status, await connect.clone().text()).toBe(200);
    const [row] = await f.t.admin.db
      .insert(schema.contractors)
      .values({
        orgId: f.a.orgId,
        name: CP,
        inn: '03744097401851',
        phone: '+996505890076',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        startDate: '2026-01-15',
        responsibleEmployeeId: person('acc-a').employeeId,
      })
      .returning({ id: schema.contractors.id });
    cp = row!.id;
    // Бухгалтер: НДС просрочен, 1-Т — сегодня и в четверг, ещё один 1-Т — на следующей неделе.
    ids.nds = await manual('nds', '2026-08-01', '2026-10-14');
    ids.today = await manual('t1m', '2026-09-01', '2026-10-19');
    ids.thu = await manual('t1m', '2026-08-01', '2026-10-22');
    ids.next = await manual('t1m', '2026-07-01', '2026-11-02');
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('«/myweek» присылает виджет со своими отчётами недели; второй делает первый устаревшим', async () => {
    const w = await myWeek(CHAT.acc);
    expect(w.caption).toBe(fill(TPL.tgWgCaption, { даты: '19.10–25.10', сдать: 2, просрочено: 1 }));
    expect(w.html).toContain(JSON.stringify(TPL.tgBtnWgRefresh));
    // HTML виджета — не больше 4 КБ после сжатия zlib (предел Telegram).
    expect(deflateSync(Buffer.from(w.html, 'utf8'), { level: 9 }).length).toBeLessThanOrEqual(
      BOT_WIDGET_HTML_ZIP_MAX,
    );
    const data = dataOf(w.chatData);
    expect(data.h).toBe(fill(TPL.tgWgHead, { даты: '19.10–25.10' }));
    expect(data.u).toBe(fill(TPL.tgWgUpd, { время: '09:00' }));
    // Просроченный — первым, со сроком вместо статуса; отчёт следующей недели не попадает.
    expect(data.r.map((r) => [r[0], r[1], r[3]])).toEqual([
      [0, CP, 0],
      [1, CP, 0],
      [4, CP, 0],
    ]);
    expect(data.r[0]![2]).toContain('срок 14.10');
    expect(data.t.map((t) => t[1])).toEqual([1, 1, 0, 0, 1, 0]);
    expect(data.t[0]![0]).toBe(TPL.tgWgOver);
    const saved = await record(person('acc-a').userId);
    expect(saved).toMatchObject({
      orgId: f.a.orgId,
      chatId: CHAT.acc,
      messageId: w.messageId,
      items: [ids.nds, ids.today, ids.thu],
      sentOn: '2026-10-19',
    });
    // Отправка записана в журнал отправок.
    const [log] = await f.t.admin.db
      .select()
      .from(schema.telegramOutbox)
      .where(
        and(eq(schema.telegramOutbox.chatId, CHAT.acc), eq(schema.telegramOutbox.kind, 'bot_cmd')),
      );
    expect(log).toMatchObject({ kind: 'bot_cmd', status: 'sent', text: w.caption });

    // Подпись кнопки меню — та же команда; новый виджет помечает прежний «устарел».
    const before = tg.widgetEdits.length;
    await say(CHAT.acc, TPL.tgCmdWidget);
    const second = tg.widgets.at(-1)!;
    expect(second.messageId).not.toBe(w.messageId);
    expect(tg.widgetEdits.slice(before)).toEqual([
      { chatId: CHAT.acc, messageId: w.messageId, chatData: JSON.stringify({ o: TPL.tgWgOld }) },
    ]);
    expect((await record(person('acc-a').userId))!.messageId).toBe(second.messageId);
    // Галочка в устаревшем виджете — «Кнопка устарела».
    expect(await ask(CHAT.acc, w.messageId, 'd:1:1')).toBe(TPL.tgActStale);
  });

  it('только свои отчёты; без права — «Нет права»; простой текст и отказ Telegram — ответ «Неделя»', async () => {
    // Владелец видит все отчёты, но в виджете — только те, где он ответственный.
    const own = dataOf((await myWeek(CHAT.owner)).chatData);
    expect(own.r).toEqual([]);
    expect(own.n).toBe(TPL.tgWgNone);
    // Нет права «Просматривать отчёты».
    const widgets = tg.widgets.length;
    await say(CHAT.senior, '/myweek');
    expect(tg.widgets).toHaveLength(widgets);
    expect(sent(CHAT.senior).at(-1)!.text).toBe(TPL.tgActNoRight);
    // Свой «Сообщения простым текстом» — ответ «Неделя» обычным сообщением.
    await f.t.admin.db
      .update(schema.users)
      .set({ telegramPlain: true })
      .where(eq(schema.users.id, person('acc-a').userId));
    await say(CHAT.acc, '/myweek');
    expect(tg.widgets).toHaveLength(widgets);
    expect(sent(CHAT.acc).at(-1)!.text).toContain('Неделя 19.10–25.10');
    await f.t.admin.db
      .update(schema.users)
      .set({ telegramPlain: false })
      .where(eq(schema.users.id, person('acc-a').userId));
    // Telegram виджет не принял — тот же ответ, прежний виджет остаётся действующим.
    const current = (await record(person('acc-a').userId))!.messageId;
    tg.failNext({
      ok: false,
      errorCode: 400,
      description: 'Bad Request: method not found',
      permanent: true,
    });
    const texts = sent(CHAT.acc).length;
    await say(CHAT.acc, '/myweek');
    expect(sent(CHAT.acc)).toHaveLength(texts + 1);
    expect(sent(CHAT.acc).at(-1)!.text).toContain('Неделя 19.10–25.10');
    expect((await record(person('acc-a').userId))!.messageId).toBe(current);
  });

  it('галочка «Сдан» сдаёт отчёт через Telegram, виджет отмечает строку; повтор — «Кнопка устарела»', async () => {
    const w = await myWeek(CHAT.acc);
    const row = await rowOf('acc-a', ids.today);
    const label = labelOf(dataOf(w.chatData), row);
    const edits = tg.widgetEdits.length;
    expect(await ask(CHAT.acc, w.messageId, `d:${row}:${await v()}`)).toBe(
      fill(TPL.tgWgDone, { отчёт: label }),
    );
    expect(await report(ids.today)).toMatchObject({
      status: 'submitted',
      submittedOn: '2026-10-19',
    });
    const [history] = await f.t.admin.db
      .select({ to: schema.statusHistory.toStatus, via: schema.statusHistory.via })
      .from(schema.statusHistory)
      .where(eq(schema.statusHistory.entityId, ids.today))
      .orderBy(desc(schema.statusHistory.at), desc(schema.statusHistory.id));
    expect(history).toEqual({ to: 'submitted', via: 'telegram' });
    const edit = tg.widgetEdits.slice(edits);
    expect(edit).toHaveLength(1);
    expect(edit[0]).toMatchObject({ chatId: CHAT.acc, messageId: w.messageId });
    const marked = dataOf(edit[0]!.chatData);
    expect(marked.r[row]![3]).toBe(1);
    expect(marked.t[1]![1]).toBe(0);
    expect(dataOf((await record(person('acc-a').userId))!.data)).toEqual(marked);
    // Второй раз та же строка — «Кнопка устарела», отчёт не меняется.
    expect(await ask(CHAT.acc, w.messageId, `d:${row}:${await v()}`)).toBe(TPL.tgActStale);
    // Строки нет — тоже.
    expect(await ask(CHAT.acc, w.messageId, `d:11:${await v()}`)).toBe(TPL.tgActStale);
  });

  it('нужен файл — бот просит его в чате; «Обновить» собирает список заново', async () => {
    await needFile(true);
    const w = await myWeek(CHAT.acc);
    const row = await rowOf('acc-a', ids.thu);
    const label = labelOf(dataOf(w.chatData), row);
    const texts = sent(CHAT.acc).length;
    expect(await ask(CHAT.acc, w.messageId, `d:${row}:${await v()}`)).toBe(
      fill(TPL.tgWgFile, { отчёт: label }),
    );
    expect((await report(ids.thu)).status).toBe('todo');
    expect(sent(CHAT.acc)).toHaveLength(texts + 1);
    const askMessage = sent(CHAT.acc).at(-1)!;
    expect(askMessage.text).toContain('1-Т');
    expect((askMessage.options.keyboard ?? []).flat()).toEqual([
      { text: 'Отмена', data: 'askCancel' },
    ]);
    // Вторая галочка — бот уже ждёт файл: вторая просьба не уходит.
    expect(await ask(CHAT.acc, w.messageId, `d:${row}:${await v()}`)).toBe(
      fill(TPL.tgWgFile, { отчёт: label }),
    );
    expect(sent(CHAT.acc)).toHaveLength(texts + 1);
    await needFile(false);

    // «Обновить»: сданный сегодня ушёл из списка.
    const edits = tg.widgetEdits.length;
    expect(await ask(CHAT.acc, w.messageId, 'u')).toBeUndefined();
    const fresh = dataOf(tg.widgetEdits.at(-1)!.chatData);
    expect(tg.widgetEdits).toHaveLength(edits + 1);
    expect(fresh.r).toHaveLength(2);
    expect((await record(person('acc-a').userId))!.items).toEqual([ids.nds, ids.thu]);
    // Галочка со старого списка (Telegram правку не показал) — «Кнопка устарела», а не чужая строка.
    expect(await ask(CHAT.acc, w.messageId, `d:1:${(await v()) - 1}`)).toBe(TPL.tgActStale);
    expect((await report(ids.thu)).status).toBe('todo');
    // Отчёт сдали не из виджета (ответом файлом, на сайте) — галочка только отмечает строку.
    await f.t.admin.db
      .update(schema.reports)
      .set({ status: 'submitted' })
      .where(eq(schema.reports.id, ids.thu));
    const before = tg.widgetEdits.length;
    expect(await ask(CHAT.acc, w.messageId, `d:1:${await v()}`)).toBeUndefined();
    expect(dataOf(tg.widgetEdits.at(-1)!.chatData).r[1]![3]).toBe(1);
    expect(tg.widgetEdits).toHaveLength(before + 1);
    await f.t.admin.db
      .update(schema.reports)
      .set({ status: 'todo' })
      .where(eq(schema.reports.id, ids.thu));
  });

  it('отказы: «Действия из Telegram», чужой чат и организация, группа, чужой отправитель, неверный запрос', async () => {
    const w = await myWeek(CHAT.acc);
    const row = await rowOf('acc-a', ids.thu);
    await settings({ telegramActions: false });
    expect(await ask(CHAT.acc, w.messageId, `d:${row}:${await v()}`)).toBe(TPL.tgActOff);
    // «Обновить» ничего не меняет — работает и без «Действий из Telegram».
    expect(await ask(CHAT.acc, w.messageId, 'u')).toBeUndefined();
    await settings({ telegramActions: true });
    // Сотрудник организации Б с номером чужого виджета.
    expect(await ask(CHAT.accB, w.messageId, `d:${row}:${await v()}`)).toBe(TPL.tgActStale);
    expect(await ask(CHAT.accB, w.messageId, 'u')).toBe(TPL.tgActStale);
    // Чат без привязки.
    expect(await ask(7999, w.messageId, `d:${row}:${await v()}`)).toBe(TPL.tgActStale);
    // Сотрудник своей организации со своим чатом и номером чужого виджета.
    expect(await ask(CHAT.hr, w.messageId, `d:${row}:${await v()}`)).toBe(TPL.tgActStale);
    // Не личный чат, не хозяин чата, не тот запрос — пустой ответ, без действия.
    expect(
      await ask(CHAT.acc, w.messageId, `d:${row}:${await v()}`, { chatType: 'group' }),
    ).toBeUndefined();
    expect(
      await ask(CHAT.acc, w.messageId, `d:${row}:${await v()}`, { fromId: CHAT.hr }),
    ).toBeUndefined();
    expect(await ask(CHAT.acc, w.messageId, 'repDone:x')).toBeUndefined();
    expect(await ask(CHAT.acc, w.messageId, 'd:123:1')).toBeUndefined();
    expect((await report(ids.thu)).status).toBe('todo');
    // Право отняли после отправки: галочка и «Обновить» — «Нет права».
    await f.t.admin.db
      .update(schema.employees)
      .set({ roleId: f.roleIds.senior })
      .where(eq(schema.employees.id, person('acc-a').employeeId));
    expect(await ask(CHAT.acc, w.messageId, `d:${row}:${await v()}`)).toBe(TPL.tgActNoRight);
    expect(await ask(CHAT.acc, w.messageId, 'u')).toBe(TPL.tgActNoRight);
    await f.t.admin.db
      .update(schema.employees)
      .set({ roleId: f.templateRole(f.a, 'acc') })
      .where(eq(schema.employees.id, person('acc-a').employeeId));
    // Временный пароль и заблокированная учётная запись — «Нет права».
    for (const patch of [{ mustChangePassword: true }, { blocked: true }]) {
      await f.t.admin.db
        .update(schema.users)
        .set(patch)
        .where(eq(schema.users.id, person('acc-a').userId));
      expect(await ask(CHAT.acc, w.messageId, `d:${row}:${await v()}`)).toBe(TPL.tgActNoRight);
      expect(await ask(CHAT.acc, w.messageId, 'u')).toBe(TPL.tgActNoRight);
      await f.t.admin.db
        .update(schema.users)
        .set({ mustChangePassword: false, blocked: false })
        .where(eq(schema.users.id, person('acc-a').userId));
    }
    expect((await report(ids.thu)).status).toBe('todo');
  });

  it('утром бот обновляет действующие виджеты без нового сообщения; уволенному — нет', async () => {
    const w = await myWeek(CHAT.acc);
    await myWeek(CHAT.hr);
    // Вторник: «Сводка дня» организации.
    clock.set('2026-10-20T03:00:00Z');
    const widgets = tg.widgets.length;
    const edits = tg.widgetEdits.length;
    await f.t.admin.db
      .update(schema.employees)
      .set({ active: false })
      .where(eq(schema.employees.id, person('hr-a').employeeId));
    await telegramRemindersJob(SITE, noPause).run(deps, clock.now());
    expect(tg.widgets).toHaveLength(widgets);
    const fresh = tg.widgetEdits.slice(edits);
    // Виджет владельца (прислан раньше) тоже обновился; уволенному — нет.
    expect(fresh.map((e) => e.chatId).sort()).toEqual([CHAT.owner, CHAT.acc]);
    expect(fresh.find((e) => e.chatId === CHAT.acc)!.messageId).toBe(w.messageId);
    const data = dataOf(fresh.find((e) => e.chatId === CHAT.acc)!.chatData);
    expect(data.u).toBe(fill(TPL.tgWgUpd, { время: '09:00' }));
    // Вторник: вкладки с сегодняшнего дня.
    expect(data.t[0]![0]).toBe(TPL.tgWgOver);
    expect(data.t).toHaveLength(1 + 4);
    // Повторный запуск в тот же день — без второго обновления.
    await telegramRemindersJob(SITE, noPause).run(deps, clock.now());
    expect(tg.widgetEdits).toHaveLength(edits + 2);
  });
});
