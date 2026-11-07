import { createFakeTelegram, fixedClock, type ErrorReporter } from '@buhuchet/adapters';
import { finishJobRun, schema } from '@buhuchet/db';
import { createTestDatabase, databaseAvailable, type TestDatabase } from '@buhuchet/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiDeps, Job } from '../deps';
import { STAND_MARK } from '../modules/admin/leads';
import { createTestDeps } from '../testing';
import { ALERT_STAND_MARK } from './alerts';
import { telegramWebhookJob } from './registry';
import { overdueSlot, runDueJobs } from './runner';

const JOB_HUNG_ERROR = 'Не закончилась за 10 минут: оборвана по времени или процесс остановлен';

describe('пропущенный слот: прошлый слот, окно догоняния которого с запасом 15 минут закончилось', () => {
  const at = (iso: string) => new Date(iso);
  it('ежедневная задача с окном в час — слот вчерашний, пока не прошёл сегодняшний с запасом', () => {
    const job: Job = { name: 'x', cron: '0 9 * * *', lookbackMinutes: 60, run: async () => {} };
    // 18.10 10:14 по Бишкеку: окно 09:00 + час + 15 минут ещё идёт — последний «просроченный» слот вчерашний.
    expect(overdueSlot(job, at('2026-10-18T04:14:00Z'))).toEqual(at('2026-10-17T03:00:00Z'));
    expect(overdueSlot(job, at('2026-10-18T04:15:00Z'))).toEqual(at('2026-10-18T03:00:00Z'));
  });
  it('каждую минуту — слот 16 минут назад; редкая задача — в пределах недели', () => {
    const minute: Job = { name: 'm', cron: '* * * * *', lookbackMinutes: 1, run: async () => {} };
    expect(overdueSlot(minute, at('2026-10-18T04:30:20Z'))).toEqual(at('2026-10-18T04:14:00Z'));
    const weekly: Job = { name: 'w', cron: '0 9 * * 1', run: async () => {} };
    // 18.10.2026 — воскресенье: прошлый понедельник 12.10.
    expect(overdueSlot(weekly, at('2026-10-18T04:00:00Z'))).toEqual(at('2026-10-12T03:00:00Z'));
  });
});

describe.skipIf(!databaseAvailable())('задачи по расписанию: повтор и оповещения', () => {
  let t: TestDatabase;
  let adminId: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    const [admin, blocked] = await t.admin.db
      .insert(schema.users)
      .values([
        { login: 'root', passwordHash: '!', isPlatformAdmin: true },
        { login: 'root-blocked', passwordHash: '!', isPlatformAdmin: true, blocked: true },
      ])
      .returning({ id: schema.users.id });
    adminId = admin!.id;
    await t.admin.db.insert(schema.telegramLinks).values([
      { userId: admin!.id, orgId: null, chatId: 5001 },
      { userId: blocked!.id, orgId: null, chatId: 5002 },
    ]);
  });

  afterAll(async () => {
    await t?.drop();
  });

  beforeEach(async () => {
    await t.admin.db.delete(schema.schedulerRuns);
    await t.admin.db.delete(schema.schedulerJobs);
    await t.admin.db.delete(schema.telegramOutbox);
  });

  const alerts = () =>
    t.admin.db
      .select()
      .from(schema.telegramOutbox)
      .where(eq(schema.telegramOutbox.kind, 'alert'))
      .orderBy(schema.telegramOutbox.createdAt);
  const runs = (job: string) =>
    t.admin.db.select().from(schema.schedulerRuns).where(eq(schema.schedulerRuns.job, job));

  function setup(jobs: Job[], start: string, over: Partial<ApiDeps> = {}) {
    const clock = fixedClock(start);
    const telegram = createFakeTelegram();
    const deps = createTestDeps({ db: t.app.db, clock, jobs, telegram, ...over });
    const tick = (iso: string) => {
      clock.set(iso);
      return runDueJobs(deps, jobs);
    };
    return { deps, clock, telegram, tick };
  }

  it('упавший слот повторяется через 2 и через 10 минут, не больше 3 попыток; после третьей — оповещение', async () => {
    const run = vi.fn(async () => {
      throw new Error('сеть недоступна');
    });
    const job: Job = { name: 'test.daily', cron: '0 9 * * *', lookbackMinutes: 24 * 60, run };
    const { tick, telegram } = setup([job], '2026-10-18T03:00:00Z');

    expect((await tick('2026-10-18T03:00:00Z')).ran).toEqual([
      { job: 'test.daily', slot: '2026-10-18T03:00:00.000Z', ok: false },
    ]);
    // Пауза перед вторым запуском — 2 минуты.
    expect((await tick('2026-10-18T03:01:00Z')).skipped).toEqual(['test.daily']);
    expect((await tick('2026-10-18T03:02:00Z')).ran).toHaveLength(1);
    // Перед третьим — 10 минут.
    expect((await tick('2026-10-18T03:11:00Z')).skipped).toEqual(['test.daily']);
    expect(await alerts()).toEqual([]);
    expect((await tick('2026-10-18T03:12:00Z')).ran).toHaveLength(1);
    // Больше 3 попыток слот не получает: ждёт следующего.
    expect((await tick('2026-10-18T05:00:00Z')).skipped).toEqual(['test.daily']);
    expect(run).toHaveBeenCalledTimes(3);
    expect(await runs('test.daily')).toEqual([
      expect.objectContaining({ attempts: 3, ok: false, error: 'сеть недоступна' }),
    ]);

    // Оповещение — одно, незаблокированному администратору с Telegram, ушло сразу.
    const sent = await alerts();
    expect(sent).toEqual([
      expect.objectContaining({ orgId: null, userId: adminId, chatId: 5001, status: 'sent' }),
    ]);
    expect(sent[0]!.text).toBe(
      '⚠️ Сбой: задача по расписанию «test.daily» не выполняется, неудачных попыток подряд: 3.\nПоследняя ошибка: сеть недоступна\nСайт повторяет её сам. Если не придёт сообщение «снова выполняется», проверьте журнал сайта.',
    );
    expect(telegram.sent.map((m) => m.chatId)).toEqual([5001]);

    // Следующий день — новый слот, первая попытка.
    expect((await tick('2026-10-19T03:00:00Z')).ran).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('серия неудач — одно оповещение; первая удача — «снова выполняется»; новая серия — новое оповещение', async () => {
    let fail = true;
    const job: Job = {
      name: 'telegram.reminders',
      cron: '* * * * *',
      lookbackMinutes: 1,
      run: async () => {
        if (fail) throw new Error('нет соединения');
      },
    };
    const { tick } = setup([job], '2026-10-18T03:00:00Z');
    for (const m of ['00', '01', '02', '03', '04']) await tick(`2026-10-18T03:${m}:00Z`);
    expect((await alerts()).map((a) => a.text)).toEqual([
      expect.stringContaining(
        '«Напоминания в Telegram» не выполняется, неудачных попыток подряд: 3',
      ),
    ]);
    fail = false;
    await tick('2026-10-18T03:05:00Z');
    await tick('2026-10-18T03:06:00Z');
    expect((await alerts()).map((a) => a.text)).toEqual([
      expect.stringContaining('неудачных попыток подряд: 3'),
      '✅ Задача по расписанию «Напоминания в Telegram» снова выполняется.',
    ]);
    fail = true;
    for (const m of ['07', '08', '09']) await tick(`2026-10-18T03:${m}:00Z`);
    expect(await alerts()).toHaveLength(3);
    const [state] = await t.admin.db.select().from(schema.schedulerJobs);
    expect(state).toMatchObject({ job: 'telegram.reminders', fails: 3, alert: 'failing' });
  });

  it('на тестовом стенде — с пометкой «🧪 Тестовый стенд»; без бота — остаётся в очереди', async () => {
    const job: Job = {
      name: 'test.minute',
      cron: '* * * * *',
      lookbackMinutes: 1,
      run: () => Promise.reject(new Error('x')),
    };
    const { tick } = setup([job], '2026-10-18T03:00:00Z', {
      config: { ...createTestDeps().config, APP_ENV: 'staging' },
      telegram: null,
    });
    for (const m of ['00', '01', '02']) await tick(`2026-10-18T03:${m}:00Z`);
    const [alert] = await alerts();
    expect(ALERT_STAND_MARK).toBe(STAND_MARK);
    expect(alert!.text!.startsWith(STAND_MARK + '⚠️ Сбой')).toBe(true);
    expect(alert!.status).toBe('pending');
  });

  it('зависшая попытка через 10 минут — неудачная, слот повторяется; поздний итог прежней попытки не пишется', async () => {
    const run = vi.fn(async () => {});
    const job: Job = { name: 'test.daily', cron: '0 9 * * *', lookbackMinutes: 24 * 60, run };
    const slot = new Date('2026-10-18T03:00:00Z');
    // Функцию оборвало: попытка начата, итога нет.
    await t.admin.db
      .insert(schema.schedulerRuns)
      .values({ job: 'test.daily', slot, startedAt: slot, attempts: 1 });
    const { tick } = setup([job], '2026-10-18T03:09:00Z');

    expect((await tick('2026-10-18T03:09:00Z')).skipped).toEqual(['test.daily']);
    expect(await runs('test.daily')).toEqual([expect.objectContaining({ finishedAt: null })]);
    // 10 минут прошло: попытка неудачная, повтор — через 2 минуты после этой отметки.
    expect((await tick('2026-10-18T03:10:00Z')).skipped).toEqual(['test.daily']);
    expect(await runs('test.daily')).toEqual([
      expect.objectContaining({ ok: false, error: JOB_HUNG_ERROR, attempts: 1 }),
    ]);
    expect((await tick('2026-10-18T03:12:00Z')).ran).toEqual([
      { job: 'test.daily', slot: slot.toISOString(), ok: true },
    ]);
    expect(run).toHaveBeenCalledTimes(1);

    await finishJobRun(t.app.db, {
      job: 'test.daily',
      slot,
      attempt: 1,
      now: new Date('2026-10-18T03:13:00Z'),
      error: 'поздняя ошибка',
    });
    expect(await runs('test.daily')).toEqual([
      expect.objectContaining({ ok: true, error: null, attempts: 2 }),
    ]);
    // Неудача и успех подряд: серия сброшена, оповещения не было.
    expect(await alerts()).toEqual([]);
    expect((await t.admin.db.select().from(schema.schedulerJobs))[0]).toMatchObject({ fails: 0 });
  });

  it('давно брошенные попытки только закрываются: в неудачи подряд не идут', async () => {
    const job: Job = {
      name: 'test.minute',
      cron: '* * * * *',
      lookbackMinutes: 1,
      run: async () => {},
    };
    await t.admin.db.insert(schema.schedulerRuns).values(
      ['01', '02', '03'].map((d) => ({
        job: 'test.minute',
        slot: new Date(`2026-10-${d}T03:00:00Z`),
        startedAt: new Date(`2026-10-${d}T03:00:00Z`),
      })),
    );
    const { tick } = setup([job], '2026-10-18T03:00:00Z', { jobs: [] });
    await tick('2026-10-18T03:00:00Z');
    const old = (await runs('test.minute')).filter((r) => r.slot < new Date('2026-10-18'));
    expect(old.map((r) => [r.ok, r.error])).toEqual([
      [false, JOB_HUNG_ERROR],
      [false, JOB_HUNG_ERROR],
      [false, JOB_HUNG_ERROR],
    ]);
    expect(await t.admin.db.select().from(schema.schedulerJobs)).toEqual([
      expect.objectContaining({ job: 'test.minute', fails: 0 }),
    ]);
    expect(await alerts()).toEqual([]);
  });

  it('задачи, которые не запускались дольше положенного, — одно оповещение на все; повторно не приходит', async () => {
    const daily: Job = {
      name: 'test.a',
      cron: '0 9 * * *',
      lookbackMinutes: 60,
      run: async () => {},
    };
    const minute: Job = {
      name: 'telegram.send',
      cron: '* * * * *',
      lookbackMinutes: 1,
      run: async () => {},
    };
    const fresh: Job = { name: 'test.new', cron: '0 9 * * *', run: async () => {} };
    const { tick, deps } = setup([daily, minute], '2026-10-18T03:00:00Z');
    await tick('2026-10-18T03:00:00Z');
    expect(await alerts()).toEqual([]);

    // Вызовов не было больше суток: 19.10 11:00 по Бишкеку. Новая задача ещё не запускалась — её не сравнить.
    const jobs = [daily, minute, fresh];
    deps.clock = fixedClock('2026-10-19T05:00:00Z');
    await runDueJobs(deps, jobs);
    const [alert, ...rest] = await alerts();
    expect(rest).toEqual([]);
    expect(alert!.text).toBe(
      '⚠️ Задачи по расписанию не запускались дольше положенного:\n' +
        '• «test.a»: последний запуск — 18.10.2026 09:00, по расписанию был нужен 19.10.2026 09:00\n' +
        '• «Отправка сообщений Telegram»: последний запуск — 18.10.2026 09:00, по расписанию был нужен 19.10.2026 10:44\n' +
        'Проверьте, что Vercel Cron (или worker на сервере) вызывает сайт каждую минуту.',
    );
    // Через минуту — снова не приходит: «test.a» уже в оповещении, «telegram.send» запускалась.
    deps.clock = fixedClock('2026-10-19T05:01:00Z');
    await runDueJobs(deps, jobs);
    expect(await alerts()).toHaveLength(1);
    const states = await t.admin.db.select().from(schema.schedulerJobs);
    expect(Object.fromEntries(states.map((s) => [s.job, s.alert]))).toEqual({
      'test.a': 'missed',
      'telegram.send': null,
    });
  });

  it('ошибка задачи уходит в Sentry вместе с именем задачи, слотом и попыткой', async () => {
    const capture = vi.fn<ErrorReporter['capture']>(async () => {});
    const err = new Error('сломалось');
    const job: Job = { name: 'test.x', cron: '* * * * *', run: () => Promise.reject(err) };
    const { tick } = setup([job], '2026-10-18T03:00:00Z', { errors: { capture } });
    await tick('2026-10-18T03:00:00Z');
    expect(capture).toHaveBeenCalledWith(err, {
      job: 'test.x',
      slot: '2026-10-18T03:00:00.000Z',
      attempt: 1,
    });
  });

  it('слежение не мешает задачам: его ошибка — в журнал, задачи выполняются', async () => {
    const run = vi.fn(async () => {});
    const job: Job = { name: 'test.x', cron: '* * * * *', run };
    const capture = vi.fn<ErrorReporter['capture']>(async () => {});
    // База, в которой нет таблицы состояния задач, — как если бы слежение сломалось.
    const { tick, deps } = setup([job], '2026-10-18T03:00:00Z', { errors: { capture } });
    // Любой select падает: и цепочка запроса, и её ожидание отвечают ошибкой.
    const failing: unknown = new Proxy(() => {}, {
      get: (_t, prop) =>
        prop === 'then'
          ? (_ok: unknown, fail: (e: Error) => void) => fail(new Error('нет таблицы'))
          : () => failing,
    });
    const db = new Proxy(deps.db, {
      get(target, prop, receiver) {
        if (prop === 'select') return () => failing;
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    deps.db = db;
    expect((await tick('2026-10-18T03:00:00Z')).ran).toEqual([
      { job: 'test.x', slot: '2026-10-18T03:00:00.000Z', ok: true },
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(expect.any(Error), { watch: 'hung' });
    expect(capture).toHaveBeenCalledWith(expect.any(Error), { watch: 'missed' });
  });

  describe('вебхук бота', () => {
    const webhook = telegramWebhookJob({
      url: 'https://test.buhuchet.kg/api/telegram/webhook',
      secretToken: 's',
    });

    it('Telegram отметил ошибку доставки с прошлой проверки — оповещение, не чаще раза в 3 часа', async () => {
      const { deps, telegram, clock } = setup([webhook], '2026-10-18T04:00:00Z');
      telegram.webhookInfo = {
        lastErrorAt: new Date('2026-10-18T03:55:00Z'),
        lastError: 'Wrong response from the webhook: 500 Internal Server Error',
        pendingUpdates: 7,
      };
      await webhook.run(deps, clock.now());
      expect(telegram.webhook?.url).toBe('https://test.buhuchet.kg/api/telegram/webhook');
      const [alert] = await alerts();
      expect(alert!.text).toBe(
        '⚠️ Telegram не может доставить сообщения боту сайта: «Wrong response from the webhook: 500 Internal Server Error» (18.10.2026 09:55). Ждут доставки: 7.\nПроверьте Админка → «Телеграм» → «Бот платформы» → «Проверить вебхук».',
      );
      // Через 10 минут — новая ошибка в те же 3 часа: второго сообщения нет.
      clock.set('2026-10-18T04:10:00Z');
      telegram.webhookInfo = {
        ...telegram.webhookInfo,
        lastErrorAt: new Date('2026-10-18T04:05:00Z'),
      };
      await webhook.run(deps, clock.now());
      expect(await alerts()).toHaveLength(1);
    });

    it('старая ошибка (до прошлой проверки) и её отсутствие — без оповещения', async () => {
      const { deps, telegram, clock } = setup([webhook], '2026-10-18T04:00:00Z');
      telegram.webhookInfo = { lastErrorAt: new Date('2026-10-18T03:48:00Z'), lastError: 'x' };
      await webhook.run(deps, clock.now());
      telegram.webhookInfo = {};
      await webhook.run(deps, clock.now());
      expect(await alerts()).toEqual([]);
    });
  });
});
