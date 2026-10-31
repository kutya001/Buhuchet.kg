import {
  createFakeTelegram,
  fixedClock,
  type FakeTelegram,
  type FixedClock,
} from '@buhuchet/adapters';
import {
  createManualReport,
  enqueueTelegram,
  listOutbox,
  schema,
  withOrgContext,
} from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { ApiError, NotifySettingsResponse, Task, TaskList, TaskSummary } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  linkTelegram,
  signIn,
  TEST_PASSWORD,
} from '../../testing';
import { telegramSendJob } from './outbox';
import { telegramRemindersJob } from './reminders';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type App = ReturnType<typeof createApp>;

const BASE = 'http://localhost:3000';
const noPause = async () => {};
const CHAT = { owner: 6000, acc: 6001 } as const;

// Понедельник, 19.10.2026, 09:00 по Бишкеку — время сводки по умолчанию; срок «за 3 дня» — четверг 22.10.
describe.skipIf(!databaseAvailable())('Напоминания и сообщения в Telegram (задача 2.25)', () => {
  let f: Fixture;
  let tg: FakeTelegram;
  let clock: FixedClock;
  let deps: ApiDeps;
  let app: App;
  let owner: string;
  let chief: string;
  let acc: string;
  let cpAcc = '';
  let cpChief = '';

  const employee = (login: string) => f.people[login]!.employeeId;
  const call = (method: 'GET' | 'POST' | 'PUT', path: string, cookie: string, body?: unknown) =>
    apiRequest(app, method, path, cookie, body);
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const to = (chatId: number) => tg.sent.filter((m) => m.chatId === chatId).map((m) => m.text);
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(f.t.app.db, { orgId: f.a.orgId, userId: f.a.ownerUserId }, fn);
  const manual = (contractorId: string, reportTypeCode: string, month: string, due: string) =>
    inA((tx) =>
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
    );
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
  const notify = async (cookie: string) => {
    const res = await call('GET', '/api/telegram/notify', cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    return NotifySettingsResponse.parse(await res.json());
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    tg = createFakeTelegram();
    clock = fixedClock('2026-10-19T03:00:00Z');
    deps = createTestDeps({ db: f.t.app.db, telegram: tg, clock });
    app = createApp(deps);
    await f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: { telegram: true, tasks: true }, remindDays: [3], reportConfirm: true })
      .where(eq(schema.orgSettings.orgId, f.a.orgId));
    [owner, chief, acc] = await Promise.all([
      signIn(app, 'owner-a', TEST_PASSWORD),
      signIn(app, 'chief-a', TEST_PASSWORD),
      signIn(app, 'acc-a', TEST_PASSWORD),
    ]);
    // Привязан Telegram у владельца и бухгалтера; у главного бухгалтера — нет.
    await linkTelegram(app, owner, CHAT.owner);
    await linkTelegram(app, acc, CHAT.acc);
    cpAcc = await contractor('ОсОО «Ала-Тоо Трейд»', '03744097401851', employee('acc-a'));
    cpChief = await contractor('ИП Садыков', '20101199000123', employee('chief-a'));
    await manual(cpAcc, 't1m', '2026-09-01', '2026-10-22');
    await manual(cpAcc, 'nds', '2026-09-01', '2026-10-22');
    await manual(cpChief, 't1m', '2026-09-01', '2026-10-22');
    tg.sent.length = 0;
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('п. 8: одно сообщение за 3 дня до срока со всеми своими отчётами, в понедельник — сводка на неделю; повтор — без дублей', async () => {
    await telegramRemindersJob(BASE, noPause).run(deps, clock.now());
    const mine = to(CHAT.acc);
    expect(mine).toHaveLength(1);
    const text = mine[0]!;
    expect(text).toContain('⏰ Через 3 дн. срок сдачи: ');
    expect(text).toContain('1-Т за Сентябрь 2026 — ОсОО «Ала-Тоо Трейд»');
    expect(text).toContain('НДС за Сентябрь 2026 — ОсОО «Ала-Тоо Трейд»');
    expect(text).toContain('🗓 Неделя ');
    expect(text).not.toContain('ИП Садыков');
    expect(text).toMatch(/Открыть в Buhuchet\.kg: http:\/\/localhost:3000\/app\/reports\/week$/);
    // Ответственный без Telegram: его отчёт приходит владельцу с пометкой.
    const boss = to(CHAT.owner);
    expect(boss).toHaveLength(1);
    expect(boss[0]).toContain('ИП Садыков (chief-a: не привязан Telegram)');
    // Повтор в тот же день (и через минуту) ничего не добавляет.
    await telegramRemindersJob(BASE, noPause).run(deps, clock.now());
    clock.advance(60_000);
    await telegramRemindersJob(BASE, noPause).run(deps, clock.now());
    expect(tg.sent).toHaveLength(2);
    clock.set('2026-10-19T03:00:00Z');
  });

  it('«Задачи»: регулярные задачи по отчётам месяца и «Отчёты мои за месяц»', async () => {
    const res = await call('GET', '/api/tasks?tab=mine&size=all', acc);
    expect(res.status, await res.clone().text()).toBe(200);
    const items = TaskList.parse(await res.json()).items.filter((r) => r.kind === 'regular');
    expect(items.map((r) => r.title).sort()).toEqual([
      'Сдать 1-Т за Сентябрь 2026 — ОсОО «Ала-Тоо Трейд»',
      'Сдать и оплатить НДС за Сентябрь 2026 — ОсОО «Ала-Тоо Трейд»',
    ]);
    expect(items[0]).toMatchObject({
      executor: { id: employee('acc-a') },
      open: true,
      report: { status: 'todo', mark: null },
    });
    const summary = TaskSummary.parse(await (await call('GET', '/api/tasks/summary', acc)).json());
    expect(summary.progress.mine).toEqual({ done: 0, total: 2 });

    // Сумма и оплата отчёта — только с правом «Менять статус» (п. Б-11).
    const nds = items.find((r) => r.title.startsWith('Сдать и оплатить НДС'))!;
    await f.t.admin.db
      .update(schema.reports)
      .set({ amount: 125_050, paid: 25_000 })
      .where(eq(schema.reports.id, nds.id));
    const ndsOf = async () =>
      TaskList.parse(
        await (await call('GET', '/api/tasks?tab=mine&size=all', acc)).json(),
      ).items.find((r) => r.id === nds.id)!;
    expect(await ndsOf()).toMatchObject({ report: { amount: 125_050, paid: 25_000 } });
    const accRole = f.templateRole(f.a, 'acc');
    const right = and(
      eq(schema.rolePermissions.roleId, accRole),
      eq(schema.rolePermissions.permissionId, 'changeStatus'),
    );
    await f.t.admin.db.delete(schema.rolePermissions).where(right);
    try {
      expect(await ndsOf()).toMatchObject({ report: { amount: null, paid: 0 } });
      const tab = await call('GET', `/api/contractors/${cpAcc}/tasks`, acc);
      expect(tab.status, await tab.clone().text()).toBe(200);
      const row = ((await tab.json()) as { items: { id: string; report?: unknown }[] }).items.find(
        (r) => r.id === nds.id,
      );
      expect(row).toMatchObject({ report: { amount: null, paid: 0 } });
    } finally {
      await f.t.admin.db
        .insert(schema.rolePermissions)
        .values({ orgId: f.a.orgId, roleId: accRole, permissionId: 'changeStatus' });
    }
  });

  it('п. 41: исполнитель получает в Telegram новую задачу и возврат на доработку с причиной; выключил «Ручные задачи» — не получает', async () => {
    const created = await call('POST', '/api/tasks', chief, {
      title: 'Собрать первичку за октябрь',
      description: '',
      categoryCode: 'КАТ-001',
      contractorId: null,
      executorEmployeeId: employee('acc-a'),
      term: 'day',
      dueDate: '2026-10-25',
      needFile: false,
      confirm: true,
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const task = Task.parse(await created.json());
    expect(to(CHAT.acc).at(-1)).toContain(
      'Новая задача от chief-a: Собрать первичку за октябрь, срок 25.10.2026.',
    );
    expect((await call('POST', `/api/tasks/${task.id}/done`, acc, {})).status).toBe(200);
    const back = await call('POST', `/api/tasks/${task.id}/rework`, chief, {
      reason: 'Нет сентября',
    });
    expect(back.status, await back.clone().text()).toBe(200);
    expect(to(CHAT.acc).at(-1)).toContain(
      '↩️ Задача возвращена на доработку: Собрать первичку за октябрь. Причина: Нет сентября. Вернул: chief-a',
    );
    // «Ручные задачи» выключены в профиле — сообщений о задачах нет.
    const before = tg.sent.length;
    const settings = await notify(acc);
    const off = await call('PUT', '/api/telegram/notify', acc, {
      version: settings.version,
      mode: settings.mode,
      off: ['tasks'],
    });
    expect(off.status, await off.clone().text()).toBe(200);
    expect((await call('POST', `/api/tasks/${task.id}/done`, acc, {})).status).toBe(200);
    expect(
      (await call('POST', `/api/tasks/${task.id}/rework`, chief, { reason: 'Ещё раз' })).status,
    ).toBe(200);
    expect(tg.sent.length).toBe(before);
  });

  it('«Уведомления в Telegram»: режим — только у владельца и главного бухгалтера; устаревшая версия — 409', async () => {
    expect((await apiRequest(app, 'GET', '/api/telegram/notify')).status).toBe(401);
    const mine = await notify(acc);
    expect(mine).toMatchObject({ boss: false, mode: 'all', off: ['tasks'] });
    const body = { version: mine.version, mode: mine.mode, off: mine.off };
    const mode = await call('PUT', '/api/telegram/notify', acc, { ...body, mode: 'digest' });
    expect(mode.status).toBe(403);
    expect((await failure(mode)).code).toBe('notify_boss_only');
    const before = await call('PUT', '/api/telegram/notify', acc, { ...body, off: ['before'] });
    expect(before.status).toBe(403);
    const stale = await call('PUT', '/api/telegram/notify', acc, {
      version: mine.version - 1,
      mode: 'all',
      off: [],
    });
    expect(stale.status).toBe(409);
    expect(
      (
        await call('PUT', '/api/telegram/notify', acc, {
          version: mine.version,
          mode: 'all',
          off: [],
        })
      ).status,
    ).toBe(200);
    expect(await notify(acc)).toMatchObject({ off: [], version: mine.version + 1 });
    const boss = await notify(owner);
    expect(boss).toMatchObject({ boss: true, mode: 'all' });
    const saved = await call('PUT', '/api/telegram/notify', owner, {
      version: boss.version,
      mode: 'digest',
      off: [],
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(NotifySettingsResponse.parse(await saved.json())).toMatchObject({ mode: 'digest' });
    // Лишнее поле в теле — 400.
    expect(
      (await call('PUT', '/api/telegram/notify', owner, { version: 1, mode: 'all', off: [], x: 1 }))
        .status,
    ).toBe(400);
  });

  it('очередь: 429 — повтор через паузу Telegram, постоянная ошибка — сразу «Ошибка», после 5 попыток — «Ошибка»', async () => {
    const job = telegramSendJob(noPause);
    const queue = (text: string) =>
      withOrgContext(f.t.app.db, { orgId: f.a.orgId, kind: 'job' }, (tx) =>
        enqueueTelegram(
          tx,
          [{ userId: f.a.ownerUserId, chatId: CHAT.owner, kind: 'reminders', text }],
          clock.now(),
        ),
      );
    const row = async (id: string) => (await inA((tx) => listOutbox(tx))).find((r) => r.id === id)!;

    const [slow] = await queue('Пауза от Telegram');
    tg.failNext({
      ok: false,
      errorCode: 429,
      description: 'Too Many Requests',
      retryAfterSeconds: 30,
      permanent: false,
    });
    await job.run(deps, clock.now());
    expect(await row(slow!)).toMatchObject({
      status: 'pending',
      tries: 1,
      lastError: '429: Too Many Requests',
    });
    await job.run(deps, clock.now());
    expect((await row(slow!)).tries).toBe(1);
    clock.advance(30_000);
    await job.run(deps, clock.now());
    expect(await row(slow!)).toMatchObject({ status: 'sent', tries: 2 });
    expect(to(CHAT.owner).at(-1)).toBe('Пауза от Telegram');

    const [blocked] = await queue('Бот заблокирован');
    tg.failNext({
      ok: false,
      errorCode: 403,
      description: 'Forbidden: bot was blocked by the user',
      permanent: true,
    });
    await job.run(deps, clock.now());
    expect(await row(blocked!)).toMatchObject({ status: 'error', tries: 1 });

    const [flaky] = await queue('Сбой сети');
    for (let n = 1; n <= 5; n++) {
      tg.failNext({ ok: false, errorCode: 502, description: 'Bad Gateway', permanent: false });
      await job.run(deps, clock.now());
      expect((await row(flaky!)).tries).toBe(n);
      clock.advance(10 * 60_000);
    }
    expect(await row(flaky!)).toMatchObject({
      status: 'error',
      tries: 5,
      lastError: '502: Bad Gateway',
    });
    await job.run(deps, clock.now());
    expect(to(CHAT.owner)).not.toContain('Сбой сети');
  });
});
