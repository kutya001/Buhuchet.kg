import {
  createFakeTelegram,
  createMemoryStorage,
  fixedClock,
  type FakeTelegram,
  type FixedClock,
  type MemoryStorage,
} from '@buhuchet/adapters';
import { createManualReport, loadEmployeeAccess, schema, withOrgContext } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  askBotMessage,
  confirmBotMessage,
  reportBotMessage,
  TELEGRAM_TEMPLATE_DEFAULTS,
  type BotMessage,
} from '@buhuchet/domain';
import { Task } from '@buhuchet/shared';
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
import { attachStoredFile } from '../files/attach';
import { sendBotMessage } from './bot';
import { BOT_REPLY_RATE_LIMIT } from './reply';
import { telegramRemindersJob } from './reminders';
import { taskView } from './staff-view';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type App = ReturnType<typeof createApp>;

const TPL = TELEGRAM_TEMPLATE_DEFAULTS;
const SITE = 'https://stand.example';
const noPause = async () => {};
const CHAT = {
  owner: 7000,
  chief: 7001,
  acc: 7002,
  hr: 7003,
  senior: 7004,
  accB: 7100,
  ownerB: 7101,
} as const;
const LABELS = { work: 'В работе', done: 'Сдан', open: 'Открыть' };
const CP = 'ОсОО «Ала-Тоо Трейд»';
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{([^}]+)\}/g, (_, k: string) => String(values[k] ?? ''));

// Понедельник, 19.10.2026, 09:00 по Бишкеку; напоминание «за 3 дня» — срок 22.10.
describe.skipIf(!databaseAvailable())(
  'Действия сотрудника из чата бота: отчёты, задачи, подтверждение сдачи (Т2)',
  () => {
    let f: Fixture;
    let tg: FakeTelegram;
    let clock: FixedClock;
    let storage: MemoryStorage;
    let deps: ApiDeps;
    let app: App;
    let owner: string;
    let cpAcc = '';
    let cpChief = '';
    /** Отчёты бухгалтера: 1-Т (без суммы) и НДС (с суммой) за сентябрь, срок 22.10. */
    let t1 = '';
    let nds = '';

    const person = (login: string) => f.people[login]!;
    let ownerOf: Record<string, string> = {};
    const sent = (chatId: number) =>
      tg.sent.map((m, i) => ({ ...m, id: tg.messageIds[i]! })).filter((m) => m.chatId === chatId);
    const last = (chatId: number) => sent(chatId).at(-1)!;
    const keys = (m: { options: FakeTelegram['sent'][number]['options'] }) =>
      (m.options.keyboard ?? []).flat();
    const press = async (chatId: number, messageId: number, data: string) => {
      const res = await sendToBot(app, telegramPress(data, chatId, messageId));
      expect(res.status).toBe(200);
      return tg.answers.at(-1)!;
    };
    const say = async (
      chatId: number,
      text: string | null,
      options: Parameters<typeof telegramUpdate>[2] = {},
    ) => {
      const res = await sendToBot(app, telegramUpdate(text, chatId, options));
      expect(res.status).toBe(200);
      return last(chatId);
    };
    /** Сообщение с кнопками получателю — как его отправил бы бот. */
    const give = async (login: string, chatId: number, message: BotMessage) => {
      expect(
        await sendBotMessage(
          deps,
          { userId: ownerOf[login] ?? person(login).userId, chatId },
          message,
          'reminders',
          't',
        ),
      ).toBe(true);
      return last(chatId);
    };
    const reportMessage = (id: string) =>
      reportBotMessage({ id, name: '1-Т', contractor: CP, todo: true }, 'срок 22.10', LABELS, null);
    const confirmMessage = (id: string) =>
      confirmBotMessage(
        { id, name: '1-Т', contractor: CP },
        'сдан 19.10',
        { ok: 'Подтвердить', back: 'Вернуть', open: 'Открыть' },
        null,
      );
    const report = async (id: string) => {
      const [row] = await f.t.admin.db
        .select()
        .from(schema.reports)
        .where(eq(schema.reports.id, id));
      return row!;
    };
    const statusVia = async (id: string) => {
      const [row] = await f.t.admin.db
        .select({ to: schema.statusHistory.toStatus, via: schema.statusHistory.via })
        .from(schema.statusHistory)
        .where(eq(schema.statusHistory.entityId, id))
        .orderBy(desc(schema.statusHistory.at), desc(schema.statusHistory.id));
      return row;
    };
    const filesOf = (kind: 'report' | 'task', id: string) =>
      f.t.admin.db
        .select()
        .from(schema.files)
        .where(and(eq(schema.files.sourceKind, kind), eq(schema.files.sourceId, id)));
    const manual = async (
      contractorId: string,
      reportTypeCode: string,
      month: string,
      due: string,
      orgId = f.a.orgId,
      userId = f.a.ownerUserId,
    ) =>
      (
        await withOrgContext(f.t.app.db, { orgId, userId }, (tx) =>
          createManualReport(
            tx,
            {
              contractorId,
              reportTypeCode,
              month,
              eventDate: null,
              due,
              reasonCode: 'ПРЧ-001',
              reasonName: 'Продление от госоргана',
            },
            { today: clock.today(), scope: undefined },
          ),
        )
      ).id;
    async function contractor(name: string, inn: string, responsible: string) {
      const [row] = await f.t.admin.db
        .insert(schema.contractors)
        .values({
          orgId: f.a.orgId,
          name,
          inn,
          phone: '+996505890076',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-01-15',
          responsibleEmployeeId: responsible,
        })
        .returning({ id: schema.contractors.id });
      return row!.id;
    }
    const settings = (patch: Partial<typeof schema.orgSettings.$inferInsert>) =>
      f.t.admin.db
        .update(schema.orgSettings)
        .set(patch)
        .where(eq(schema.orgSettings.orgId, f.a.orgId));
    const FEATURES = { telegram: true, tasks: true, files: true };
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
    const pdf = (fileId: string, name = 'Квитанция.pdf', bytes = 5) => {
      tg.files.set(fileId, new Uint8Array(bytes).fill(7));
      return { fileId, name, size: bytes };
    };

    beforeAll(async () => {
      f = await createStaffFixture();
      ownerOf = { 'owner-a': f.a.ownerUserId, 'owner-b': f.b.ownerUserId };
      await seedAllPlatformDictionaries(f.t.admin.db);
      tg = createFakeTelegram();
      clock = fixedClock('2026-10-19T03:00:00Z');
      storage = createMemoryStorage();
      deps = createTestDeps({ db: f.t.app.db, telegram: tg, clock, storage });
      app = createApp(deps);
      await settings({ features: FEATURES, remindDays: [3], reportConfirm: true });
      const cookies: Record<string, string> = {};
      for (const [login, chat] of [
        ['owner-a', CHAT.owner],
        ['chief-a', CHAT.chief],
        ['acc-a', CHAT.acc],
        ['hr-a', CHAT.hr],
        ['senior-a', CHAT.senior],
        ['acc-b', CHAT.accB],
        ['owner-b', CHAT.ownerB],
      ] as const) {
        cookies[login] = await signIn(app, login, TEST_PASSWORD);
        await linkTelegram(app, cookies[login]!, chat);
      }
      owner = cookies['owner-a']!;
      const connect = await apiRequest(app, 'POST', '/api/org-report-types/connect', owner, {
        connect: ['nds', 't1m'],
        disconnect: [],
      });
      expect(connect.status, await connect.clone().text()).toBe(200);
      cpAcc = await contractor(CP, '03744097401851', person('acc-a').employeeId);
      cpChief = await contractor('ИП Садыков', '20101199000123', person('chief-a').employeeId);
      t1 = await manual(cpAcc, 't1m', '2026-09-01', '2026-10-22');
      nds = await manual(cpAcc, 'nds', '2026-09-01', '2026-10-22');
      await manual(cpChief, 't1m', '2026-09-01', '2026-10-22');
      tg.sent.length = 0;
      tg.messageIds.length = 0;
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('напоминание: сообщение дня и следом — по сообщению с кнопками на каждый свой отчёт; «Открыть» ведёт на сайт', async () => {
      await telegramRemindersJob(SITE, noPause).run(deps, clock.now());
      const mine = sent(CHAT.acc);
      expect(mine).toHaveLength(3);
      expect(mine[0]!.text).toContain('⏰ Через 3 дн. срок сдачи: ');
      expect(keys(mine[0]!)).toEqual([]);
      const byReport = new Map(
        mine.slice(1).map((m) => [
          keys(m)
            .find((b) => b.url)!
            .url!.split('report=')[1]!,
          m,
        ]),
      );
      expect([...byReport.keys()].sort()).toEqual([t1, nds].sort());
      const one = byReport.get(t1)!;
      expect(one.text).toBe(`1-Т за Сентябрь 2026\n${CP} · срок 22.10 · через 3 дн.`);
      expect(keys(one)).toEqual([
        { text: 'В работе', data: `repWork:${t1}` },
        { text: 'Сдан', data: `repDone:${t1}` },
        { text: 'Открыть', url: `${SITE}/app/reports/all?report=${t1}` },
      ]);
      // Чужие отчёты кнопок не получают: у главного бухгалтера — только его отчёт.
      const others = sent(CHAT.chief).flatMap((m) => keys(m).map((b) => b.data ?? ''));
      expect(others.some((d) => d.includes(t1) || d.includes(nds))).toBe(false);
      // Повтор в тот же день ничего не добавляет.
      const before = tg.sent.length;
      await telegramRemindersJob(SITE, noPause).run(deps, clock.now());
      expect(tg.sent.length).toBe(before);
    });

    it('«В работе» и «Сдан»: статус меняется, история — «через Telegram», кнопка гаснет, повтор — «Кнопка устарела»', async () => {
      const m = sent(CHAT.acc).find((x) => keys(x).some((b) => b.data === `repWork:${t1}`))!;
      const full = `1-Т за Сентябрь 2026, ${CP}`;
      const work = await press(CHAT.acc, m.id, `repWork:${t1}`);
      expect(work.text).toBe(fill(TPL.tgActRepWork, { отчёт: full }));
      expect((await report(t1)).status).toBe('in_progress');
      expect(await statusVia(t1)).toEqual({ to: 'in_progress', via: 'telegram' });
      expect(tg.edits.at(-1)).toMatchObject({ chatId: CHAT.acc, messageId: m.id });
      expect(tg.edits.at(-1)!.keyboard.flat()[0]).toMatchObject({
        text: '✓ В работе',
        disabled: true,
      });
      expect((await press(CHAT.acc, m.id, `repWork:${t1}`)).text).toBe(TPL.tgActStale);

      // «Сдача отчётов требует подтверждения» включена — отчёт ждёт подтверждения.
      const done = await press(CHAT.acc, m.id, `repDone:${t1}`);
      expect(done.text).toBe(fill(TPL.tgActRepWait, { отчёт: full }));
      const row = await report(t1);
      expect(row).toMatchObject({
        status: 'submitted',
        submittedOn: '2026-10-19',
        submittedBy: person('acc-a').userId,
        confirmedAt: null,
      });
      expect(await statusVia(t1)).toEqual({ to: 'submitted', via: 'telegram' });
      expect((await press(CHAT.acc, m.id, `repDone:${t1}`)).text).toBe(TPL.tgActStale);
      expect((await report(t1)).version).toBe(row.version);

      // На сайте: «История статусов» карточки отчёта и «История» контрагента — с отметкой «через Telegram».
      const card = await apiRequest(app, 'GET', `/api/reports/${t1}`, owner);
      expect(card.status).toBe(200);
      const { statusHistory } = (await card.json()) as {
        statusHistory: { to: string; via?: string | null }[];
      };
      expect(statusHistory.map((h) => [h.to, h.via ?? null])).toEqual(
        expect.arrayContaining([
          ['todo', null],
          ['in_progress', 'telegram'],
          ['submitted', 'telegram'],
        ]),
      );
      const feed = await apiRequest(app, 'GET', `/api/contractors/${cpAcc}/history`, owner);
      expect(feed.status).toBe(200);
      const { items } = (await feed.json()) as { items: { via?: string | null }[] };
      expect(items.some((x) => x.via === 'telegram')).toBe(true);
      expect(items.some((x) => !x.via)).toBe(true);
    });

    it('«Сдан» без суммы налога — на сайт; чужая организация, область «Свои», право и «Действия из Telegram» проверяются при нажатии', async () => {
      const m = sent(CHAT.acc).find((x) => keys(x).some((b) => b.data === `repDone:${nds}`))!;
      const full = `НДС за Сентябрь 2026, ${CP}`;
      expect((await press(CHAT.acc, m.id, `repDone:${nds}`)).text).toBe(
        fill(TPL.tgActRepSum, { отчёт: full }),
      );

      // «Действия из Telegram» выключены владельцем.
      await settings({ telegramActions: false });
      expect((await press(CHAT.acc, m.id, `repWork:${nds}`)).text).toBe(TPL.tgActOff);
      await settings({ telegramActions: true });

      // Чужая организация: сообщение с номером чужого отчёта — отчёта для неё нет.
      const alien = await give('acc-b', CHAT.accB, reportMessage(nds));
      expect((await press(CHAT.accB, alien.id, `repWork:${nds}`)).text).toBe(TPL.tgActStale);
      // Область «Свои»: отчёт чужого контрагента — «Нет права».
      const hr = await give('hr-a', CHAT.hr, reportMessage(nds));
      expect((await press(CHAT.hr, hr.id, `repWork:${nds}`)).text).toBe(TPL.tgActNoRight);
      // Нет права «Менять статус отчётов».
      const senior = await give('senior-a', CHAT.senior, reportMessage(nds));
      expect((await press(CHAT.senior, senior.id, `repWork:${nds}`)).text).toBe(TPL.tgActNoRight);
      // Кнопки нет в отправленном сообщении — данные нажатия сами ничего не разрешают.
      expect((await press(CHAT.acc, m.id, `confOk:${nds}`)).text).toBe(TPL.tgActStale);
      expect(await report(nds)).toMatchObject({ status: 'todo', version: 1 });
      expect(await statusVia(nds)).toEqual({ to: 'todo', via: null });
    });

    it('«Сдан» с обязательным файлом: бот просит файл, не тот ответ объясняет, файл прикрепляется и отчёт сдан', async () => {
      await needFile(true);
      const id = await manual(cpAcc, 't1m', '2026-08-01', '2026-10-22');
      const full = `1-Т за Август 2026, ${CP}`;
      const m = await give('acc-a', CHAT.acc, reportMessage(id));
      const answer = await press(CHAT.acc, m.id, `repDone:${id}`);
      expect(answer.text).toBeUndefined();
      const ask = last(CHAT.acc);
      expect(ask.text).toBe(fill(TPL.tgRepAskFile, { отчёт: full }));
      expect(keys(ask)).toEqual([{ text: 'Отмена', data: 'askCancel' }]);
      expect((await report(id)).status).toBe('todo');
      // Вторая просьба о том же не отправляется.
      expect((await press(CHAT.acc, m.id, `repDone:${id}`)).text).toBe(TPL.tgActAskWait);
      expect(last(CHAT.acc).id).toBe(ask.id);

      expect((await say(CHAT.acc, 'вот файл')).text).toBe(TPL.tgAskNeedFile);
      expect(
        (await say(CHAT.acc, null, { document: { fileId: 'x', name: 'отчёт.exe', size: 10 } }))
          .text,
      ).toBe(TPL.tgFileType);
      expect(
        (
          await say(CHAT.acc, null, {
            document: { fileId: 'x', name: 'отчёт.pdf', size: 21 * 1048576 },
          })
        ).text,
      ).toBe(fill(TPL.tgFileBig, { мб: 20 }));
      // Размер со слов Telegram занижен — сверяется фактический.
      tg.files.set('big', new Uint8Array(20 * 1048576 + 1));
      expect(
        (await say(CHAT.acc, null, { document: { fileId: 'big', name: 'отчёт.pdf', size: 5 } }))
          .text,
      ).toBe(fill(TPL.tgFileBig, { мб: 20 }));
      tg.files.delete('big');
      expect((await report(id)).status).toBe('todo');
      expect(storage.files.size).toBe(0);

      // Файл без ответа на сообщение относится к последней открытой просьбе чата.
      const ok = await say(CHAT.acc, null, {
        document: pdf('f1'),
        caption: 'Принято  ГНС\n19.10',
      });
      expect(ok.text).toBe(fill(TPL.tgActRepWait, { отчёт: full }));
      expect(await report(id)).toMatchObject({ status: 'submitted', submittedOn: '2026-10-19' });
      const [file] = await filesOf('report', id);
      expect(file).toMatchObject({
        orgId: f.a.orgId,
        name: 'Квитанция.pdf',
        sizeBytes: 5,
        contentType: 'application/pdf',
        state: 'ready',
        note: 'Принято ГНС 19.10',
        contractorId: cpAcc,
        createdBy: person('acc-a').userId,
      });
      expect(file!.storageKey).toBe(`org/${f.a.orgId}/files/${file!.id}`);
      expect([...storage.files.keys()]).toEqual([file!.storageKey]);
      const [attach] = await f.t.admin.db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entityId, id), eq(schema.auditLog.action, 'file_attach')));
      expect(attach).toMatchObject({ via: 'telegram', actorUserId: person('acc-a').userId });
      expect(attach!.changes).toEqual([{ field: 'file', to: 'Квитанция.pdf' }]);
      // Просьба закрыта, кнопка «Сдан» под отчётом погасла.
      const [closed, pressed] = tg.edits.slice(-2);
      expect(closed).toMatchObject({ messageId: ask.id });
      expect(closed!.keyboard.flat()[0]).toMatchObject({ disabled: true });
      expect(pressed).toMatchObject({ messageId: m.id });
      expect(pressed!.keyboard.flat().map((b) => [b.text, b.disabled ?? false])).toEqual([
        ['В работе', true],
        ['✓ Сдан', true],
      ]);
      // Бот больше ничего не ждёт: следующий файл остаётся без ответа и никуда не кладётся.
      const before = tg.sent.length;
      await sendToBot(app, telegramUpdate(null, CHAT.acc, { document: pdf('f2') }));
      expect(tg.sent.length).toBe(before);
      expect(storage.files.size).toBe(1);
      await needFile(false);
    });

    it('просьба бота: «Отмена», конец дня, ответ на сообщение; чужой отправитель не принимается', async () => {
      await needFile(true);
      const id = await manual(cpAcc, 't1m', '2026-07-01', '2026-10-22');
      const m = await give('acc-a', CHAT.acc, reportMessage(id));
      await press(CHAT.acc, m.id, `repDone:${id}`);
      const first = last(CHAT.acc);
      const files = storage.files.size;
      // «Отмена»: бот перестаёт ждать, запись не меняется.
      expect((await press(CHAT.acc, first.id, 'askCancel')).text).toBe(TPL.tgActCancelled);
      expect((await press(CHAT.acc, first.id, 'askCancel')).text).toBe(TPL.tgActStale);
      const quiet = tg.sent.length;
      await sendToBot(
        app,
        telegramUpdate(null, CHAT.acc, { document: pdf('c1'), replyTo: first.id }),
      );
      expect(tg.sent.length).toBe(quiet);

      // Новая просьба; на следующий день она уже не действует — даже ответом на сообщение.
      await press(CHAT.acc, m.id, `repDone:${id}`);
      const second = last(CHAT.acc);
      expect(second.id).not.toBe(first.id);
      clock.advance(24 * 3600_000);
      const stale = tg.sent.length;
      await sendToBot(
        app,
        telegramUpdate(null, CHAT.acc, { document: pdf('c2'), replyTo: second.id }),
      );
      expect(tg.sent.length).toBe(stale);
      clock.set('2026-10-19T03:00:00Z');
      // Сообщение не от владельца чата (пересланное в группу и т. п.) не принимается.
      await sendToBot(
        app,
        telegramUpdate(null, CHAT.acc, { document: pdf('c3'), replyTo: second.id, fromId: 999 }),
      );
      expect((await report(id)).status).toBe('todo');
      expect(storage.files.size).toBe(files);

      // Ответом на сообщение-просьбу файл принимается.
      const ok = await say(CHAT.acc, null, { document: pdf('c4'), replyTo: second.id });
      expect(ok.text).toContain('отмечен «Сдан»');
      expect((await report(id)).status).toBe('submitted');
      expect(storage.files.size).toBe(files + 1);
      await needFile(false);
    });

    it('файл боту не обходит правила: нет права, чужая организация, «Файлы в карточках» выключены — файл не остаётся в хранилище', async () => {
      await needFile(true);
      const id = await manual(cpAcc, 't1m', '2026-06-01', '2026-10-22');
      const today = clock.today();
      const ask = (action: string): BotMessage =>
        askBotMessage('Пришлите файл.', { action, arg: id, kind: 'file', day: today }, 'Отмена');
      const files = storage.files.size;

      // Просьба в чате сотрудника без права «Менять статус отчётов».
      await give('senior-a', CHAT.senior, ask('repFile'));
      expect((await say(CHAT.senior, null, { document: pdf('n1') })).text).toBe(TPL.tgActNoRight);
      // Чужая организация: отчёта для неё нет.
      await give('acc-b', CHAT.accB, ask('repFile'));
      expect((await say(CHAT.accB, null, { document: pdf('n2') })).text).toBe(TPL.tgActStale);
      // Область «Свои»: отчёт чужого контрагента.
      await give('hr-a', CHAT.hr, ask('repFile'));
      expect((await say(CHAT.hr, null, { document: pdf('n3') })).text).toBe(TPL.tgActNoRight);
      // Действие без ответа на просьбу (кнопочное) файлом не вызывается.
      await give('acc-a', CHAT.acc, ask('repDone'));
      expect((await say(CHAT.acc, null, { document: pdf('n4') })).text).toBe(TPL.tgActStale);
      await press(CHAT.acc, last(CHAT.acc).id - 1, 'askCancel');

      // «Файлы в карточках» выключены — отчёт с обязательным файлом отмечается на сайте.
      await give('acc-a', CHAT.acc, ask('repFile'));
      await settings({ features: { ...FEATURES, files: false } });
      expect((await say(CHAT.acc, null, { document: pdf('n5') })).text).toBe(
        fill(TPL.tgActRepSite, { отчёт: `1-Т за Июнь 2026, ${CP}` }),
      );
      await settings({ features: FEATURES });

      expect((await report(id)).status).toBe('todo');
      expect(await filesOf('report', id)).toEqual([]);
      expect(storage.files.size).toBe(files);
      await needFile(false);
    });

    it('прикрепление файла, положенного сервером: правила сайта — функция, область, право «Загружать файлы», чужая организация', async () => {
      const id = await manual(cpAcc, 't1m', '2026-05-01', '2026-10-22');
      const foreign = await manual(cpChief, 't1m', '2026-05-01', '2026-10-22');
      const attach = (login: string, orgId: string, reportId: string, fileId: string) =>
        withOrgContext(f.t.app.db, { orgId, userId: person(login).userId }, async (tx) => {
          const access = (await loadEmployeeAccess(tx, person(login).employeeId))!;
          return attachStoredFile(deps, tx, access.subject, orgId, {
            id: fileId,
            source: { kind: 'report', id: reportId },
            name: 'акт.pdf',
            size: 5,
            contentType: 'application/pdf',
            storageKey: `org/${orgId}/files/${fileId}`,
            note: null,
          });
        });
      const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

      await settings({ features: { ...FEATURES, files: false } });
      expect(await attach('acc-a', f.a.orgId, id, uuid(1))).toBe('files_off');
      await settings({ features: FEATURES });
      // Отчёт чужого контрагента для бухгалтера с областью «Свои» — как будто его нет.
      expect(await attach('acc-a', f.a.orgId, foreign, uuid(2))).toBe('not_found');
      // Чужая организация.
      expect(await attach('acc-b', f.b.orgId, id, uuid(3))).toBe('not_found');
      // Без права «Загружать файлы».
      const right = and(
        eq(schema.rolePermissions.roleId, f.templateRole(f.a, 'acc')),
        eq(schema.rolePermissions.permissionId, 'filesUpload'),
      );
      await f.t.admin.db.delete(schema.rolePermissions).where(right);
      try {
        expect(await attach('acc-a', f.a.orgId, id, uuid(4))).toBe('forbidden');
      } finally {
        await f.t.admin.db.insert(schema.rolePermissions).values({
          orgId: f.a.orgId,
          roleId: f.templateRole(f.a, 'acc'),
          permissionId: 'filesUpload',
        });
      }
      // Контрагент в архиве — запись не редактируется.
      await f.t.admin.db
        .update(schema.contractors)
        .set({ serviceStatus: 'archived' })
        .where(eq(schema.contractors.id, cpAcc));
      try {
        expect(['forbidden', 'not_found']).toContain(await attach('acc-a', f.a.orgId, id, uuid(5)));
      } finally {
        await f.t.admin.db
          .update(schema.contractors)
          .set({ serviceStatus: 'active' })
          .where(eq(schema.contractors.id, cpAcc));
      }
      expect(await filesOf('report', id)).toEqual([]);

      expect(await attach('acc-a', f.a.orgId, id, uuid(6))).toEqual({
        id: uuid(6),
        name: 'акт.pdf',
      });
      expect(await filesOf('report', id)).toMatchObject([{ id: uuid(6), state: 'ready' }]);
      const [log] = await f.t.admin.db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entityId, id), eq(schema.auditLog.action, 'file_attach')));
      expect(log).toMatchObject({ entity: 'report', contractorId: cpAcc, via: null });
      expect(log!.changes).toEqual([{ field: 'file', to: 'акт.pdf' }]);
    });

    it('подтверждение сдачи: «Вернуть» с причиной ответом, ответственный получает причину и кнопку «Сдан»; свой отчёт — нельзя; «Подтвердить»', async () => {
      const full = `1-Т за Сентябрь 2026, ${CP}`;
      // Без права «Подтверждать сдачу отчётов».
      const noRight = await give('acc-a', CHAT.acc, confirmMessage(t1));
      expect((await press(CHAT.acc, noRight.id, `confOk:${t1}`)).text).toBe(TPL.tgActNoRight);

      const m = await give('chief-a', CHAT.chief, confirmMessage(t1));
      await press(CHAT.chief, m.id, `confBack:${t1}`);
      const ask = last(CHAT.chief);
      expect(ask.text).toBe(fill(TPL.tgConfAskWhy, { отчёт: full }));
      expect((await say(CHAT.chief, null, { document: pdf('w1') })).text).toBe(TPL.tgAskNeedText);
      expect((await say(CHAT.chief, ' ( ) ', { replyTo: ask.id })).text).toBe(TPL.tgAskNeedText);
      expect((await report(t1)).status).toBe('submitted');

      // Код замены Telegram, которого бот ждёт в этом же чате, — раньше ответа на просьбу: шесть цифр
      // не уходят причиной возврата (один Telegram — несколько логинов).
      const codeOf = (text: string) => /^(\d{6}) — код/m.exec(text)?.[1] ?? '';
      const senior = await signIn(app, 'senior-a', TEST_PASSWORD);
      await linkTelegram(app, senior, CHAT.chief);
      const code = codeOf(last(CHAT.senior).text);
      expect(code).toMatch(/^\d{6}$/);
      const wrong = code === '000000' ? '111111' : '000000';
      expect((await say(CHAT.chief, wrong)).text).toBe(fill(TPL.tgRelinkWrong, { попыток: 4 }));
      // Чат теперь общий для двух логинов — первой строкой организация.
      expect((await say(CHAT.chief, code)).text).toBe(
        `Организация А\n${fill(TPL.tgLinked, { логин: 'senior-a' })}`,
      );
      expect((await report(t1)).status).toBe('submitted');
      // Обратно в свой чат — тем же порядком, кодом из прежнего чата.
      await linkTelegram(app, senior, CHAT.senior);
      const backCode = codeOf(
        sent(CHAT.chief)
          .map((x) => x.text)
          .findLast((x) => codeOf(x) !== '')!,
      );
      expect((await say(CHAT.senior, backCode)).text).toBe(
        fill(TPL.tgLinked, { логин: 'senior-a' }),
      );
      expect((await report(t1)).status).toBe('submitted');

      const fixAt = sent(CHAT.acc).length;
      const back = await say(CHAT.chief, '  Нет (квитанции)\nо приёме ', { replyTo: ask.id });
      expect(back.text).toBe(fill(TPL.tgConfBackOk, { отчёт: full }));
      expect((await report(t1)).status).toBe('needs_fix');
      const [returned] = await f.t.admin.db
        .select({ reason: schema.statusHistory.reason, by: schema.statusHistory.actorUserId })
        .from(schema.statusHistory)
        .where(
          and(
            eq(schema.statusHistory.entityId, t1),
            eq(schema.statusHistory.toStatus, 'needs_fix'),
          ),
        );
      expect(returned).toEqual({ reason: 'Нет квитанции о приёме', by: person('chief-a').userId });
      expect(await statusVia(t1)).toEqual({ to: 'needs_fix', via: 'telegram' });
      // Ответственному — причина и кнопка «Сдан»: исправил и сразу отметил.
      const fix = sent(CHAT.acc)[fixAt]!;
      expect(fix.text).toBe(
        `↩️ На исправление: 1-Т за Сентябрь 2026 — ${CP}. Причина: Нет квитанции о приёме. Вернул: chief-a`,
      );
      expect(keys(fix)).toEqual([{ text: 'Сдан', data: `repDone:${t1}` }]);
      expect(
        tg.edits
          .at(-1)!
          .keyboard.flat()
          .map((b) => [b.text, b.disabled ?? false]),
      ).toEqual([
        ['Подтвердить', true],
        ['↩ Возвращён', true],
      ]);
      expect((await press(CHAT.acc, fix.id, `repDone:${t1}`)).text).toBe(
        fill(TPL.tgActRepWait, { отчёт: full }),
      );

      // Свой сданный отчёт подтвердить нельзя; владельцу — можно.
      const own = await manual(cpChief, 't1m', '2026-08-01', '2026-10-22');
      const mine = await give('chief-a', CHAT.chief, reportMessage(own));
      await press(CHAT.chief, mine.id, `repDone:${own}`);
      expect((await report(own)).status).toBe('submitted');
      const self = await give('chief-a', CHAT.chief, confirmMessage(own));
      expect((await press(CHAT.chief, self.id, `confOk:${own}`)).text).toBe(TPL.tgActConfOwn);
      expect((await press(CHAT.chief, self.id, `confBack:${own}`)).text).toBe(TPL.tgActConfOwn);
      expect((await report(own)).confirmedAt).toBeNull();
      const boss = await give('owner-a', CHAT.owner, confirmMessage(own));
      expect((await press(CHAT.owner, boss.id, `confOk:${own}`)).text).toContain(
        'сдача подтверждена',
      );
      expect((await report(own)).confirmedAt).not.toBeNull();

      const again = await give('chief-a', CHAT.chief, confirmMessage(t1));
      expect((await press(CHAT.chief, again.id, `confOk:${t1}`)).text).toBe(
        fill(TPL.tgActConfOk, { отчёт: full }),
      );
      expect(await report(t1)).toMatchObject({
        status: 'submitted',
        confirmedBy: person('chief-a').userId,
      });
      expect((await press(CHAT.chief, again.id, `confBack:${t1}`)).text).toBe(TPL.tgActStale);
    });

    it('задача: исполнитель получает кнопки, «Взять в работу» и «Выполнена» — постановщику сообщение; с «Требуется файл» бот ждёт файл или фото', async () => {
      const create = async (patch: Record<string, unknown>) => {
        const res = await apiRequest(app, 'POST', '/api/tasks', owner, {
          title: 'Сверить акт',
          description: '',
          categoryCode: 'КАТ-001',
          contractorId: null,
          executorEmployeeId: person('acc-a').employeeId,
          term: 'day',
          dueDate: '2026-10-25',
          needFile: false,
          confirm: false,
          ...patch,
        });
        expect(res.status, await res.clone().text()).toBe(201);
        return Task.parse(await res.json());
      };
      const status = async (id: string) =>
        (
          await f.t.admin.db
            .select({ status: schema.tasks.status })
            .from(schema.tasks)
            .where(eq(schema.tasks.id, id))
        )[0]!.status;

      const task = await create({});
      const m = last(CHAT.acc);
      expect(m.text).toMatch(/^Сверить акт\nНовая задача от .+ · срок 25\.10\.2026$/);
      expect(keys(m)).toEqual([
        { text: 'Взять в работу', data: `taskWork:${task.id}` },
        { text: 'Выполнена', data: `taskDone:${task.id}` },
      ]);
      // Адрес сайта по https — ниже «Открыть задачу».
      const view = await taskView(
        { ...deps, config: { ...deps.config, APP_BASE_URL: SITE } },
        { id: task.id, title: task.title, todo: false },
      );
      expect(view.view!('Новая задача').buttons).toEqual([
        [{ text: 'Выполнена', action: 'taskDone', arg: task.id }],
        [{ text: 'Открыть задачу', url: `${SITE}/app/tasks/mine?task=${task.id}` }],
      ]);

      // Не исполнитель и чужая организация.
      const other = await give('hr-a', CHAT.hr, {
        text: 'Задача',
        buttons: [[{ text: 'Выполнена', action: 'taskDone', arg: task.id }]],
      });
      expect((await press(CHAT.hr, other.id, `taskDone:${task.id}`)).text).toBe(TPL.tgActNoRight);
      const alien = await give('acc-b', CHAT.accB, {
        text: 'Задача',
        buttons: [[{ text: 'Выполнена', action: 'taskDone', arg: task.id }]],
      });
      expect((await press(CHAT.accB, alien.id, `taskDone:${task.id}`)).text).toBe(TPL.tgActStale);
      expect(await status(task.id)).toBe('todo');

      expect((await press(CHAT.acc, m.id, `taskWork:${task.id}`)).text).toBe(TPL.tgActTaskWork);
      expect(await status(task.id)).toBe('in_progress');
      expect(last(CHAT.owner).text).toContain('Задача в работе: Сверить акт. Исполнитель: acc-a.');
      expect((await press(CHAT.acc, m.id, `taskWork:${task.id}`)).text).toBe(TPL.tgActStale);
      expect((await press(CHAT.acc, m.id, `taskDone:${task.id}`)).text).toBe(TPL.tgActTaskDone);
      expect(await status(task.id)).toBe('done');
      expect(last(CHAT.owner).text).toContain('Задача выполнена: Сверить акт. Исполнитель: acc-a.');
      expect(await statusVia(task.id)).toEqual({ to: 'done', via: 'telegram' });
      const card = await apiRequest(app, 'GET', `/api/tasks/${task.id}`, owner);
      expect(card.status).toBe(200);
      const seen = (await card.json()) as { statusHistory: { to: string; via?: string | null }[] };
      expect(seen.statusHistory.map((h) => [h.to, h.via ?? null])).toEqual(
        expect.arrayContaining([
          ['todo', null],
          ['in_progress', 'telegram'],
          ['done', 'telegram'],
        ]),
      );

      // «Требуется файл» и подтверждение: бот ждёт файл; фото — самый большой размер.
      const hard = await create({ title: 'Скан договора', needFile: true, confirm: true });
      const hm = last(CHAT.acc);
      await press(CHAT.acc, hm.id, `taskDone:${hard.id}`);
      expect(last(CHAT.acc).text).toBe(fill(TPL.tgTaskAskFile, { задача: 'Скан договора' }));
      expect(await status(hard.id)).toBe('todo');
      tg.files.set('p-big', new Uint8Array(20).fill(1));
      const ok = await say(CHAT.acc, null, {
        photo: [
          { fileId: 'p-small', size: 10 },
          { fileId: 'p-big', size: 20 },
        ],
      });
      expect(ok.text).toBe(TPL.tgActTaskWait);
      expect(await status(hard.id)).toBe('on_confirm');
      expect(await filesOf('task', hard.id)).toMatchObject([
        { name: 'Фото из Telegram 19.10.2026.jpg', sizeBytes: 20, state: 'ready' },
      ]);
      expect(last(CHAT.owner).text).toContain(
        'Задача выполнена и ждёт вашего подтверждения: Скан договора. Исполнитель: acc-a.',
      );
    });

    it('напоминание: больше 10 своих отчётов — кнопки у первых 10, остальные на сайте; ждущие подтверждения — «Подтвердить» и «Вернуть»', async () => {
      // 22.10: сдачи от 19.10 ждут подтверждения 3 дня; срок новых отчётов — 23.10 (за день).
      const waiting = await manual(cpAcc, 't1m', '2026-04-01', '2026-10-30');
      const wm = await give('acc-a', CHAT.acc, reportMessage(waiting));
      await press(CHAT.acc, wm.id, `repDone:${waiting}`);
      expect((await report(waiting)).status).toBe('submitted');
      // Момент сдачи ставит база по своим часам — для теста переносим его на «сегодня» теста.
      // «Дата сдачи» отчёта — днём раньше отметки: в сообщении стоит она.
      await f.t.admin.db
        .update(schema.reports)
        .set({ submittedAt: new Date('2026-10-19T04:00:00Z'), submittedOn: '2026-10-18' })
        .where(eq(schema.reports.id, waiting));
      clock.set('2026-10-22T03:00:00Z');
      // Дни напоминаний вида отчёта — за день до срока.
      await f.t.admin.db
        .update(schema.orgReportTypes)
        .set({ remindDays: [1] })
        .where(
          and(
            eq(schema.orgReportTypes.orgId, f.a.orgId),
            eq(schema.orgReportTypes.reportTypeCode, 't1m'),
          ),
        );
      for (let month = 1; month <= 12; month++) {
        await manual(cpChief, 't1m', `2025-${String(month).padStart(2, '0')}-01`, '2026-10-23');
      }
      const from = { chief: sent(CHAT.chief).length, owner: sent(CHAT.owner).length };
      await telegramRemindersJob(SITE, noPause).run(deps, clock.now());

      const mine = sent(CHAT.chief).slice(from.chief);
      const withWork = mine.filter((m) => keys(m).some((b) => b.data?.startsWith('repWork:')));
      expect(withWork).toHaveLength(10);
      // Свои несданные главного бухгалтера: два прежних и 12 новых — кнопки у 10, ещё 4 на сайте.
      const more = mine.find((m) => m.text === fill(TPL.tgMoreOnSite, { n: 10, ещё: 4 }))!;
      expect(keys(more)).toEqual([
        { text: 'Открыть отчёты на сайте', url: `${SITE}/app/reports/all` },
      ]);
      // Порядок: сообщение дня, затем сообщения с кнопками, затем «ещё на сайте».
      expect(mine.indexOf(more)).toBeGreaterThan(mine.indexOf(withWork.at(-1)!));
      expect(keys(mine[0]!)).toEqual([]);

      const boss = sent(CHAT.owner).slice(from.owner);
      const head = boss.findIndex((m) => /^⏳ Ждут вашего подтверждения: \d+$/.test(m.text));
      expect(head).toBeGreaterThan(0);
      const confirm = boss.find((m) => keys(m).some((b) => b.data === `confOk:${waiting}`))!;
      expect(boss.indexOf(confirm)).toBeGreaterThan(head);
      expect(confirm.text).toBe(`1-Т за Апрель 2026\n${CP} · сдан 18.10, acc-a`);
      expect(keys(confirm)).toEqual([
        { text: 'Подтвердить', data: `confOk:${waiting}` },
        { text: 'Вернуть', data: `confBack:${waiting}` },
        { text: 'Открыть', url: `${SITE}/app/reports/all?report=${waiting}` },
      ]);
      expect((await press(CHAT.owner, confirm.id, `confOk:${waiting}`)).text).toContain(
        'сдача подтверждена',
      );
      clock.set('2026-10-19T03:00:00Z');
      await f.t.admin.db
        .update(schema.orgReportTypes)
        .set({ remindDays: [3] })
        .where(
          and(
            eq(schema.orgReportTypes.orgId, f.a.orgId),
            eq(schema.orgReportTypes.reportTypeCode, 't1m'),
          ),
        );
    });

    it('«Сдан» до оплаты налога и уточнённый отчёт с переплатой — на сайт; «Подтвердить» без обязательной квитанции — нельзя; контрагент в архиве — «Нет права»', async () => {
      const id = await manual(cpAcc, 'nds', '2026-03-01', '2026-10-22');
      const full = `НДС за Март 2026, ${CP}`;
      const m = await give('acc-a', CHAT.acc, reportMessage(id));
      const set = (patch: Partial<typeof schema.reports.$inferInsert>) =>
        f.t.admin.db.update(schema.reports).set(patch).where(eq(schema.reports.id, id));

      // «Сдача отчёта только после оплаты»: налог начислен и не оплачен — оплату отмечают на сайте.
      await settings({ features: { ...FEATURES, taxpay: true }, payBeforeSubmit: true });
      await set({ amount: 500_000 });
      expect((await press(CHAT.acc, m.id, `repDone:${id}`)).text).toBe(
        fill(TPL.tgActRepPay, { отчёт: full }),
      );
      await settings({ features: { ...FEATURES, taxpay: false } });
      // Уточнённый отчёт, оплачено больше суммы: возврат переплаты создаётся на сайте.
      await set({ revision: 1, amount: 100_000, paid: 200_000 });
      expect((await press(CHAT.acc, m.id, `repDone:${id}`)).text).toBe(
        fill(TPL.tgActRepSite, { отчёт: full }),
      );
      expect(await report(id)).toMatchObject({ status: 'todo', version: 1 });
      await settings({ features: FEATURES });

      // Виду нужна квитанция о приёме, а файла у отчёта нет — подтвердить из чата нельзя.
      const receipt = (on: boolean) =>
        f.t.admin.db
          .update(schema.orgReportTypes)
          .set({ needReceipt: on })
          .where(
            and(
              eq(schema.orgReportTypes.orgId, f.a.orgId),
              eq(schema.orgReportTypes.reportTypeCode, 't1m'),
            ),
          );
      const sub = await manual(cpAcc, 't1m', '2026-03-01', '2026-10-22');
      const sm = await give('acc-a', CHAT.acc, reportMessage(sub));
      await press(CHAT.acc, sm.id, `repDone:${sub}`);
      expect((await report(sub)).status).toBe('submitted');
      await receipt(true);
      const cm = await give('chief-a', CHAT.chief, confirmMessage(sub));
      expect((await press(CHAT.chief, cm.id, `confOk:${sub}`)).text).toBe(
        fill(TPL.tgActConfRcpt, { отчёт: `1-Т за Март 2026, ${CP}` }),
      );
      expect((await report(sub)).confirmedAt).toBeNull();
      await receipt(false);

      // Контрагент в архиве: его отчёты из чата не меняются — ни статус, ни подтверждение.
      const todo = await manual(cpAcc, 't1m', '2026-02-01', '2026-10-22');
      const tm = await give('acc-a', CHAT.acc, reportMessage(todo));
      const archive = (serviceStatus: 'archived' | 'active') =>
        f.t.admin.db
          .update(schema.contractors)
          .set({ serviceStatus })
          .where(eq(schema.contractors.id, cpAcc));
      await archive('archived');
      try {
        expect((await press(CHAT.acc, tm.id, `repWork:${todo}`)).text).toBe(TPL.tgActNoRight);
        expect((await press(CHAT.acc, tm.id, `repDone:${todo}`)).text).toBe(TPL.tgActNoRight);
        expect((await press(CHAT.chief, cm.id, `confOk:${sub}`)).text).toBe(TPL.tgActNoRight);
      } finally {
        await archive('active');
      }
      expect(await report(todo)).toMatchObject({ status: 'todo', version: 1 });
      expect((await report(sub)).confirmedAt).toBeNull();
    });

    it('задача с «Требуется файл» при выключенных «Файлах в карточках» закрывается без файла — как на сайте', async () => {
      const res = await apiRequest(app, 'POST', '/api/tasks', owner, {
        title: 'Акт сверки',
        description: '',
        categoryCode: 'КАТ-001',
        contractorId: null,
        executorEmployeeId: person('acc-a').employeeId,
        term: 'day',
        dueDate: '2026-10-25',
        needFile: true,
        confirm: false,
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const task = Task.parse(await res.json());
      const m = last(CHAT.acc);
      await settings({ features: { ...FEATURES, files: false } });
      try {
        expect((await press(CHAT.acc, m.id, `taskDone:${task.id}`)).text).toBe(TPL.tgActTaskDone);
      } finally {
        await settings({ features: FEATURES });
      }
      const [row] = await f.t.admin.db
        .select({ status: schema.tasks.status })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, task.id));
      expect(row!.status).toBe('done');
      expect(await filesOf('task', task.id)).toEqual([]);
    });

    it('чужая организация, область «Свои» и право проверяются у каждого действия: «Сдан», «Подтвердить», «Вернуть» с причиной, «Взять в работу», файл к задаче', async () => {
      const today = clock.today();
      const rep = await manual(cpAcc, 't1m', '2026-01-01', '2026-10-22');
      const sub = await manual(cpAcc, 't1m', '2025-12-01', '2026-10-22');
      const sm = await give('acc-a', CHAT.acc, reportMessage(sub));
      await press(CHAT.acc, sm.id, `repDone:${sub}`);
      expect((await report(sub)).status).toBe('submitted');
      const created = await apiRequest(app, 'POST', '/api/tasks', owner, {
        title: 'Сверка с банком',
        description: '',
        categoryCode: 'КАТ-001',
        contractorId: null,
        executorEmployeeId: person('acc-a').employeeId,
        term: 'day',
        dueDate: '2026-10-25',
        needFile: true,
        confirm: false,
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const task = Task.parse(await created.json());
      // «Кадры»: права бухгалтера и «Подтверждать сдачу», область «Свои»; отчёты — чужого контрагента.
      const confirmRight = {
        orgId: f.a.orgId,
        roleId: f.roleIds.hr,
        permissionId: 'repConfirm' as const,
      };
      await f.t.admin.db.insert(schema.rolePermissions).values(confirmRight);
      const files = storage.files.size;
      const button = (action: string, arg: string): BotMessage => ({
        text: 'Запись',
        buttons: [[{ text: 'Кнопка', action, arg }]],
      });
      const ask = (action: string, arg: string, kind: 'file' | 'text'): BotMessage =>
        askBotMessage('Ответьте.', { action, arg, kind, day: today }, 'Отмена');

      try {
        // Нажатия: владелец чужой организации — записи для него нет; «Свои» и нет права — «Нет права».
        const presses: [string, string, [string, number, string][]][] = [
          [
            'repDone',
            rep,
            [
              ['owner-b', CHAT.ownerB, TPL.tgActStale],
              ['hr-a', CHAT.hr, TPL.tgActNoRight],
              ['senior-a', CHAT.senior, TPL.tgActNoRight],
            ],
          ],
          [
            'confOk',
            sub,
            [
              ['owner-b', CHAT.ownerB, TPL.tgActStale],
              ['hr-a', CHAT.hr, TPL.tgActNoRight],
              ['acc-a', CHAT.acc, TPL.tgActNoRight],
            ],
          ],
          [
            'confBack',
            sub,
            [
              ['owner-b', CHAT.ownerB, TPL.tgActStale],
              ['hr-a', CHAT.hr, TPL.tgActNoRight],
              ['acc-a', CHAT.acc, TPL.tgActNoRight],
            ],
          ],
          [
            'taskWork',
            task.id,
            [
              ['owner-b', CHAT.ownerB, TPL.tgActStale],
              ['hr-a', CHAT.hr, TPL.tgActNoRight],
            ],
          ],
        ];
        for (const [action, arg, cases] of presses) {
          for (const [login, chat, refusal] of cases) {
            const m = await give(login, chat, button(action, arg));
            expect((await press(chat, m.id, `${action}:${arg}`)).text, `${action} — ${login}`).toBe(
              refusal,
            );
          }
        }

        // Ответы на просьбу: причина возврата и файл к задаче.
        const replies: [string, string, 'file' | 'text', [string, number, string][]][] = [
          [
            'confWhy',
            sub,
            'text',
            [
              ['owner-b', CHAT.ownerB, TPL.tgActStale],
              ['hr-a', CHAT.hr, TPL.tgActNoRight],
              ['acc-a', CHAT.acc, TPL.tgActNoRight],
            ],
          ],
          [
            'taskFile',
            task.id,
            'file',
            [
              ['owner-b', CHAT.ownerB, TPL.tgActStale],
              ['hr-a', CHAT.hr, TPL.tgActNoRight],
            ],
          ],
        ];
        let n = 0;
        for (const [action, arg, kind, cases] of replies) {
          for (const [login, chat, refusal] of cases) {
            const m = await give(login, chat, ask(action, arg, kind));
            const answer =
              kind === 'text'
                ? await say(chat, 'Нет квитанции', { replyTo: m.id })
                : await say(chat, null, { document: pdf(`x${n++}`), replyTo: m.id });
            expect(answer.text, `${action} — ${login}`).toBe(refusal);
            // Отказ ядра просьбу не закрывает — закрываем сами, чтобы она не ждала до конца дня.
            await press(chat, m.id, 'askCancel');
          }
        }
      } finally {
        await f.t.admin.db
          .delete(schema.rolePermissions)
          .where(
            and(
              eq(schema.rolePermissions.roleId, f.roleIds.hr),
              eq(schema.rolePermissions.permissionId, 'repConfirm'),
            ),
          );
      }

      expect(await report(rep)).toMatchObject({ status: 'todo', version: 1 });
      expect(await report(sub)).toMatchObject({ status: 'submitted', confirmedAt: null });
      const [row] = await f.t.admin.db
        .select({ status: schema.tasks.status })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, task.id));
      expect(row!.status).toBe('todo');
      expect(await filesOf('task', task.id)).toEqual([]);
      expect(storage.files.size).toBe(files);
    });

    it('ответ боту: на закрытую просьбу не принимается и другой не достаётся, повтор доставки — один раз, команда — не ответ, без права файл не скачивается, не больше 30 ответов в минуту', async () => {
      const clear = () =>
        f.t.admin.db
          .delete(schema.rateLimits)
          .where(eq(schema.rateLimits.kind, BOT_REPLY_RATE_LIMIT.kind));
      await clear();
      await needFile(true);
      const ids: string[] = [];
      const asks: number[] = [];
      for (const month of ['2025-09-01', '2025-10-01', '2025-11-01']) {
        const id = await manual(cpAcc, 't1m', month, '2026-10-22');
        const m = await give('acc-a', CHAT.acc, reportMessage(id));
        await press(CHAT.acc, m.id, `repDone:${id}`);
        ids.push(id);
        asks.push(last(CHAT.acc).id);
      }
      const [a, b, c] = ids as [string, string, string];
      const statuses = async () => [
        (await report(a)).status,
        (await report(b)).status,
        (await report(c)).status,
      ];
      const files = storage.files.size;

      // Ответ на первую просьбу — сдан первый отчёт.
      await say(CHAT.acc, null, { document: pdf('r1'), replyTo: asks[0]! });
      expect(await statuses()).toEqual(['submitted', 'todo', 'todo']);
      // Ещё один файл ответом на ту же, уже закрытую просьбу: другим открытым просьбам он не достаётся.
      const quiet = tg.sent.length;
      await sendToBot(
        app,
        telegramUpdate(null, CHAT.acc, { document: pdf('r2'), replyTo: asks[0]! }),
      );
      expect(tg.sent.length).toBe(quiet);
      expect(await statuses()).toEqual(['submitted', 'todo', 'todo']);
      expect(storage.files.size).toBe(files + 1);

      // Файл без ответа на сообщение — последней открытой просьбе; повтор той же доставки от Telegram
      // следующей открытой просьбе не достаётся.
      const update = telegramUpdate(null, CHAT.acc, { document: pdf('r3') });
      expect((await sendToBot(app, update)).status).toBe(200);
      expect(await statuses()).toEqual(['submitted', 'todo', 'submitted']);
      const once = tg.sent.length;
      expect((await sendToBot(app, update)).status).toBe(200);
      expect(tg.sent.length).toBe(once);
      expect(await statuses()).toEqual(['submitted', 'todo', 'submitted']);
      expect(storage.files.size).toBe(files + 2);

      // Команда — не ответ на просьбу: бот отвечает подсказкой, просьба ждёт дальше.
      expect((await say(CHAT.acc, '/help')).text).toBe(TPL.tgStart);

      // Право «Менять статус отчётов» отобрали, пока бот ждал: файл не скачивается (такого файла у
      // Telegram нет — без проверки права заранее был бы ответ «Не получилось»).
      const right = {
        orgId: f.a.orgId,
        roleId: f.templateRole(f.a, 'acc'),
        permissionId: 'changeStatus' as const,
      };
      await f.t.admin.db
        .delete(schema.rolePermissions)
        .where(
          and(
            eq(schema.rolePermissions.roleId, right.roleId),
            eq(schema.rolePermissions.permissionId, right.permissionId),
          ),
        );
      try {
        expect(
          (
            await say(CHAT.acc, null, {
              document: { fileId: 'нет-такого', name: 'отчёт.pdf', size: 5 },
            })
          ).text,
        ).toBe(TPL.tgActNoRight);
      } finally {
        await f.t.admin.db.insert(schema.rolePermissions).values(right);
      }
      expect(await statuses()).toEqual(['submitted', 'todo', 'submitted']);
      expect(storage.files.size).toBe(files + 2);

      // Не больше 30 ответов в минуту с одного чата.
      await clear();
      for (let i = 0; i < 30; i++) {
        expect((await say(CHAT.acc, `текст ${i}`)).text).toBe(TPL.tgAskNeedFile);
      }
      expect((await say(CHAT.acc, 'ещё')).text).toBe(TPL.tgActFailed);
      await clear();
      await press(CHAT.acc, asks[1]!, 'askCancel');
      await needFile(false);
    });
  },
);
