import { createFakeTelegram, fixedClock } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import { jobDoneKey, jobTitleKey, jobWhatKey, UI_TEXTS } from '@buhuchet/domain';
import {
  AdminJobList,
  AdminJobSummary,
  AdminRunCard,
  AdminRunList,
  AdminTelegramMessage,
  ListValues,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { Job } from '../../deps';
import { jobsFor } from '../../jobs/registry';
import { runDueJobs } from '../../jobs/runner';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  signIn,
  TEST_PASSWORD,
  unzipTexts,
} from '../../testing';
import { everyText } from './runs';

/*
 * Админка → «Запуски» (решение заказчика 17.11.2026; прототип v132 admin/runs.js; docs/decisions.md
 * п. Т-15): задачи по расписанию с состоянием, журнал запусков и окно «Запуск». Запуски в тестах делает
 * настоящий исполнитель `runDueJobs` — те же строки, что на сайте.
 */

const text = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru;

describe('тексты «Запусков»: у каждой задачи сайта — название и «Что делает»', () => {
  const all = jobsFor({
    APP_BASE_URL: 'https://example.kg',
    TELEGRAM_BOT_TOKEN: 'x',
    TELEGRAM_WEBHOOK_SECRET: 'y',
  });

  it('названия и описания есть в словаре; шаблон «Что сделано» — с числом', () => {
    expect(all.length).toBeGreaterThanOrEqual(20);
    for (const job of all) {
      expect(text(jobTitleKey(job.name)), `название ${job.name}`).toBeTruthy();
      expect(text(jobWhatKey(job.name)), `«Что делает» ${job.name}`).toBeTruthy();
      const done = text(jobDoneKey(job.name));
      if (done !== undefined) expect(done, job.name).toContain('{n}');
    }
  });

  it('«Как часто» словами — у каждого расписания сайта, без «По расписанию …»', () => {
    const t = (key: string) => text(key) ?? key;
    for (const job of all) {
      const every = everyText(t, job.cron);
      expect(every, job.name).not.toContain('{');
      expect(every, `${job.name}: ${job.cron}`).not.toContain(job.cron);
    }
    expect(everyText(t, '* * * * *')).toBe('Каждую минуту');
    expect(everyText(t, '*/5 * * * *')).toBe('Каждые 5 минут');
    expect(everyText(t, '40 * * * *')).toBe('Каждый час в :40');
    expect(everyText(t, '30 3 * * *')).toBe('Каждый день в 03:30');
    expect(everyText(t, '5 0,6,12,18 * * *')).toBe('4 раза в сутки: 00:05, 06:05, 12:05, 18:05');
    expect(everyText(t, '0 9 * * 1')).toBe('По расписанию 0 9 * * 1');
  });
});

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const ADMIN_CHAT = 700_400_001;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe.skipIf(!databaseAvailable())('Админка → «Запуски»', () => {
  let f: Fixture;
  let app: ReturnType<typeof createApp>;
  let admin: string;
  let owner: string;
  const clock = fixedClock('2026-10-18T03:00:00Z');
  let sent = 0;
  // Расписания — по Бишкеку: 09:00 — это 03:00 UTC.
  const send: Job = {
    name: 'telegram.send',
    cron: '* * * * *',
    lookbackMinutes: 1,
    // Первый запуск отправил три сообщения, остальным отправлять нечего.
    run: async () => (sent++ === 0 ? 3 : 0),
  };
  const failing: Job = {
    name: 'files.storage-retry',
    cron: '0 9 * * *',
    lookbackMinutes: 24 * 60,
    run: async () => {
      throw new Error('сеть недоступна');
    },
  };
  // Задача, которая не сообщает, сколько сделала.
  const silent: Job = {
    name: 'leads.docs-purge',
    cron: '0 9 * * *',
    lookbackMinutes: 60,
    run: async () => {},
  };
  const missed: Job = {
    name: 'kb.cleanup-video-uploads',
    cron: '0 * * * *',
    lookbackMinutes: 60,
    run: async () => 0,
  };
  // Задача без своих текстов в словаре (добавили и забыли): название — служебное имя.
  const unnamed: Job = { name: 'x.custom-job', cron: '15 4 * * 2', run: async () => 0 };
  const jobs = [send, failing, silent, missed, unnamed];
  const slot = new Date('2026-10-18T03:00:00Z').getTime();

  const get = (path: string, cookie = admin) => apiRequest(app, 'GET', path, cookie);
  const runs = async (query = '') => {
    const res = await get(`/api/admin/runs${query}`);
    expect(res.status, query).toBe(200);
    return AdminRunList.parse(await res.json());
  };
  const card = async (id: string) => {
    const res = await get(`/api/admin/runs/card?id=${encodeURIComponent(id)}`);
    expect(res.status, id).toBe(200);
    return AdminRunCard.parse(await res.json());
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    const deps = createTestDeps({
      db: f.t.app.db,
      clock,
      jobs,
      telegram: createFakeTelegram(),
    });
    app = createApp(deps);
    admin = await signIn(app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(app, 'owner-a', TEST_PASSWORD);
    const adminUser = (await f.t.admin.db.select().from(schema.users)).find(
      (u) => u.isPlatformAdmin,
    );
    await f.t.admin.db
      .insert(schema.telegramLinks)
      .values({ userId: adminUser!.id, orgId: null, chatId: ADMIN_CHAT });
    // Задача, которая давно не запускалась, и старые запуски: 10 и 40 дней назад.
    await f.t.admin.db.insert(schema.schedulerJobs).values({
      job: missed.name,
      lastSlot: new Date(slot - 2 * DAY),
      lastOkAt: new Date(slot - 2 * DAY),
    });
    await f.t.admin.db.insert(schema.schedulerRuns).values(
      [10, 40].map((days) => ({
        job: missed.name,
        slot: new Date(slot - days * DAY),
        startedAt: new Date(slot - days * DAY),
        finishedAt: new Date(slot - days * DAY + 90_500),
        ok: false,
        error: `сбой ${days} дней назад`,
      })),
    );
    // 09:00, 09:01, 09:02 и 09:12 по Бишкеку: упавшая задача повторяется через 2 и через 10 минут.
    const due = [send, failing, silent];
    for (const at of ['03:00', '03:01', '03:02', '03:12']) {
      clock.set(`2026-10-18T${at}:00Z`);
      await runDueJobs(deps, due);
    }
    clock.set('2026-10-18T03:13:00Z');
    // Строка очереди Telegram создаётся по часам базы, а запуски в тесте идут по подставным часам: на
    // сайте это одно и то же время, здесь — приводим к моменту третьей попытки.
    await f.t.admin.db
      .update(schema.telegramOutbox)
      .set({ createdAt: new Date('2026-10-18T03:12:00Z') })
      .where(eq(schema.telegramOutbox.kind, 'alert'));
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('только администратору платформы: без входа — 401, сотруднику организации — 403', async () => {
    for (const path of [
      '/api/admin/runs/jobs',
      '/api/admin/runs/jobs/values?col=st',
      '/api/admin/runs/jobs/export?cols=title,st',
      '/api/admin/runs/jobs/summary',
      '/api/admin/runs',
      '/api/admin/runs/values?col=st',
      '/api/admin/runs/export?cols=start,title',
      `/api/admin/runs/card?id=${failing.name}:${slot}:1`,
    ]) {
      expect((await get(path, '')).status, path).toBe(401);
      expect((await get(path, owner)).status, path).toBe(403);
      expect((await get(path)).status, path).toBe(200);
    }
  });

  it('задачи: сначала «Падает» и «Не запускалась»; название, «Как часто», «Что делает», последний запуск', async () => {
    const res = await get('/api/admin/runs/jobs');
    const list = AdminJobList.parse(await res.json());
    expect(list.total).toBe(5);
    expect(list.items.map((j) => j.state)).toEqual(['failing', 'missed', 'missed', 'ok', 'ok']);
    const names = list.items.map((j) => j.name);
    expect(names[0]).toBe(failing.name);
    // Не запускалась дольше положенного и ни разу не запускалась.
    expect(names.slice(1, 3).sort()).toEqual([missed.name, unnamed.name].sort());
    expect(names.slice(3).sort()).toEqual([silent.name, send.name].sort());
    const by = (name: string) => list.items.find((j) => j.name === name)!;
    expect(by(failing.name)).toMatchObject({
      title: text('alert.job.files_storage_retry'),
      every: 'Каждый день в 09:00',
      what: text('runs.what.files_storage_retry'),
      lastAt: '2026-10-18T03:12:00.000Z',
      lastStatus: 'error',
      okAt: null,
      fails: 3,
    });
    expect(by(send.name)).toMatchObject({
      title: 'Отправка сообщений Telegram',
      every: 'Каждую минуту',
      lastAt: '2026-10-18T03:12:00.000Z',
      lastStatus: 'ok',
      okAt: '2026-10-18T03:12:00.000Z',
      fails: 0,
    });
    expect(by(missed.name)).toMatchObject({ every: 'Каждый час в :00', fails: 0 });
    expect(by(unnamed.name)).toMatchObject({
      title: unnamed.name,
      what: '',
      every: 'По расписанию 15 4 * * 2',
      lastAt: null,
      lastStatus: null,
    });
  });

  it('задачи: плашки, фильтр по состоянию, поиск, значения столбца и выгрузка', async () => {
    expect(AdminJobSummary.parse(await (await get('/api/admin/runs/jobs/summary')).json())).toEqual(
      { total: 5, ok: 2, failing: 1, missed: 2, dayErrors: 3 },
    );
    const filter = encodeURIComponent(JSON.stringify({ st: { type: 'enum', vals: ['missed'] } }));
    const only = AdminJobList.parse(
      await (await get(`/api/admin/runs/jobs?filters=${filter}`)).json(),
    );
    expect(only.items.map((j) => j.name).sort()).toEqual([missed.name, unnamed.name].sort());
    const found = AdminJobList.parse(
      await (
        await get(`/api/admin/runs/jobs?q=${encodeURIComponent('storage-retry')}&qcols=name`)
      ).json(),
    );
    expect(found.items.map((j) => j.name)).toEqual([failing.name]);
    const values = ListValues.parse(await (await get('/api/admin/runs/jobs/values?col=st')).json());
    expect(values.items.map((v) => [v.label, v.count]).sort()).toEqual(
      [
        ['Падает', 1],
        ['Не запускалась', 2],
        ['Работает', 2],
      ].sort(),
    );
    expect((await get('/api/admin/runs/jobs?sort=nope.asc')).status).toBe(400);
    const file = await get('/api/admin/runs/jobs/export?cols=title,every,st,fails,what,name');
    expect(file.status).toBe(200);
    const sheet = unzipTexts(new Uint8Array(await file.arrayBuffer()))['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('Отправка сообщений Telegram');
    expect(sheet).toContain('Каждый день в 09:00');
    expect(sheet).toContain('Падает');
  });

  it('запуски: по умолчанию «Важные» за 7 дней — ошибки и те, что что-то сделали; каждая попытка — строка', async () => {
    const list = await runs();
    expect(list.items.map((r) => [r.job, r.attempt, r.status, r.doneText])).toEqual([
      [failing.name, 3, 'error', null],
      [failing.name, 2, 'error', null],
      [failing.name, 1, 'error', null],
      [send.name, 1, 'ok', 'Отправлено сообщений: 3'],
    ]);
    expect(list.items[0]).toMatchObject({
      id: `${failing.name}:${slot}:3`,
      title: text('alert.job.files_storage_retry'),
      slot: '2026-10-18T03:00:00.000Z',
      startedAt: '2026-10-18T03:12:00.000Z',
      error: 'сеть недоступна',
      done: null,
    });
    expect(list.items[2]).toMatchObject({ startedAt: '2026-10-18T03:00:00.000Z' });
  });

  it('запуски: «Все» — и пустые успешные; период «Сегодня», 7 и 30 дней, старше 30 дней нет', async () => {
    const all = await runs('?all=1&size=100');
    // Четыре запуска отправки, три попытки упавшей и один запуск без числа.
    expect(all.total).toBe(8);
    const empty = all.items.filter((r) => r.job === send.name && r.done === 0);
    expect(empty).toHaveLength(3);
    expect(empty[0]).toMatchObject({ status: 'ok', doneText: 'Нечего делать' });
    expect(all.items.find((r) => r.job === silent.name)).toMatchObject({
      status: 'ok',
      done: null,
      doneText: null,
    });
    expect((await runs('?days=1')).total).toBe(4);
    const month = await runs('?days=30');
    expect(month.total).toBe(5);
    expect(month.items.at(-1)).toMatchObject({
      job: missed.name,
      error: 'сбой 10 дней назад',
      ms: 90_500,
    });
    expect(JSON.stringify(month)).not.toContain('40 дней');
    for (const bad of ['?days=5', '?days=90', '?all=2', '?all=true']) {
      expect((await get(`/api/admin/runs${bad}`)).status, bad).toBe(400);
    }
  });

  it('запуски: фильтр по итогу и задаче, поиск по ошибке, значения столбцов и выгрузка — под тем же периодом', async () => {
    const filter = (f: object) => `filters=${encodeURIComponent(JSON.stringify(f))}`;
    const errors = await runs(`?all=1&${filter({ st: { type: 'enum', vals: ['error'] } })}`);
    expect(errors.total).toBe(3);
    const ofSend = await runs(`?all=1&${filter({ title: { type: 'enum', vals: [send.name] } })}`);
    expect(ofSend.total).toBe(4);
    expect((await runs(`?days=30&q=${encodeURIComponent('10 дней')}&qcols=err`)).total).toBe(1);
    // «Длительность» и «Что сделано» — текстом, как на экране; порядок — по времени и по числу.
    expect((await runs('?all=1&days=30&sort=dur.desc')).items[0]).toMatchObject({ ms: 90_500 });
    expect((await runs('?all=1&sort=done.desc')).items[0]).toMatchObject({ done: 3 });
    expect((await runs(`?all=1&${filter({ done: { type: 'text', q: 'нечего' } })}`)).total).toBe(3);
    expect((await runs(`?days=30&${filter({ dur: { type: 'text', q: '1 мин 31' } })}`)).total).toBe(
      1,
    );
    const values = async (query: string) =>
      ListValues.parse(await (await get(`/api/admin/runs/values?${query}`)).json()).items;
    expect((await values('col=st')).map((v) => [v.label, v.count]).sort()).toEqual(
      [
        ['Ошибка', 3],
        ['Успешно', 1],
      ].sort(),
    );
    expect((await values('col=st&all=1')).map((v) => [v.label, v.count]).sort()).toEqual(
      [
        ['Ошибка', 3],
        ['Успешно', 5],
      ].sort(),
    );
    expect((await values('col=title&all=1')).map((v) => v.label)).toEqual(
      expect.arrayContaining(['Отправка сообщений Telegram']),
    );
    expect((await values('col=tr')).map((v) => v.label).sort()).toEqual([
      '1 из 3',
      '2 из 3',
      '3 из 3',
    ]);
    const file = await get('/api/admin/runs/export?cols=start,title,st,dur,tr,done,err&all=1');
    expect(file.status).toBe(200);
    const sheet = unzipTexts(new Uint8Array(await file.arrayBuffer()))['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('Отправлено сообщений: 3');
    expect(sheet).toContain('Нечего делать');
    expect(sheet).toContain('сеть недоступна');
    expect(sheet).toContain('3 из 3');
    expect(sheet).not.toContain('сбой 10 дней назад');
  });

  it('окно «Запуск»: попытка, другие попытки и сообщение о сбое администраторам из журнала Telegram', async () => {
    const third = await card(`${failing.name}:${slot}:3`);
    expect(third.run).toMatchObject({
      attempt: 3,
      status: 'error',
      error: 'сеть недоступна',
      slot: '2026-10-18T03:00:00.000Z',
      startedAt: '2026-10-18T03:12:00.000Z',
    });
    expect(third.every).toBe('Каждый день в 09:00');
    expect(third.attempts.map((a) => [a.attempt, a.status, a.startedAt])).toEqual([
      [1, 'error', '2026-10-18T03:00:00.000Z'],
      [2, 'error', '2026-10-18T03:02:00.000Z'],
    ]);
    // После третьей неудачи ушло «Сбой в работе сайта»: окно ведёт на строку журнала Telegram.
    expect(third.alert).not.toBeNull();
    const message = await get(`/api/admin/telegram/log/${third.alert!.id}`);
    expect(message.status).toBe(200);
    expect(AdminTelegramMessage.parse(await message.json()).message).toMatchObject({
      kind: 'alert',
      dir: 'out',
      fullText: expect.stringContaining('неудачных попыток подряд: 3'),
    });

    // После первой и второй попытки сообщения не было.
    const first = await card(`${failing.name}:${slot}:1`);
    expect(first.alert).toBeNull();
    expect(first.attempts.map((a) => a.attempt)).toEqual([2, 3]);
    expect((await card(`${failing.name}:${slot}:2`)).alert).toBeNull();

    const ok = await card(`${send.name}:${slot}:1`);
    expect(ok).toMatchObject({
      run: { status: 'ok', done: 3, doneText: 'Отправлено сообщений: 3', error: null },
      every: 'Каждую минуту',
      attempts: [],
      alert: null,
    });
    // Номера чата администратора в ответах нет.
    expect(JSON.stringify([third, first, ok])).not.toContain(String(ADMIN_CHAT));
  });

  it('окно «Запуск»: неверный номер — 400, нет такого запуска или попытки — 404', async () => {
    const at = (id: string) => get(`/api/admin/runs/card?id=${encodeURIComponent(id)}`);
    for (const bad of [
      '',
      'x',
      `${failing.name}:${slot}`,
      `${failing.name}:${slot}:0`,
      `A:1:1`,
      `a b:1:1`,
    ]) {
      expect((await at(bad)).status, bad).toBe(400);
    }
    expect((await at(`${failing.name}:${slot}:4`)).status).toBe(404);
    expect((await at(`${failing.name}:${slot + MINUTE}:1`)).status).toBe(404);
    expect((await at(`no.such-job:${slot}:1`)).status).toBe(404);
    expect((await get('/api/admin/runs/card')).status).toBe(400);
  });
});
