import { Writable } from 'node:stream';
import { createFakeTelegram, createLogger, fixedClock } from '@buhuchet/adapters';
import { UI_TEXTS } from '@buhuchet/domain';
import { schema } from '@buhuchet/db';
import { createTestDatabase, databaseAvailable, type TestDatabase } from '@buhuchet/db/testing';
import { ApiError, CronTickResponse } from '@buhuchet/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { createApp } from './app';
import type { ApiDeps, Job } from './deps';
import {
  cleanupLoginAttemptsJob,
  cleanupRateLimitsJob,
  cleanupSchedulerRuns,
  jobs,
  jobsFor,
  telegramWebhookJob,
} from './jobs/registry';
import { createRaceApp, createTestDeps } from './testing';

const SECRET = 'test-cron-secret-0000';
const auth = { authorization: `Bearer ${SECRET}` };

describe('/api/cron/tick без базы', () => {
  it('без секрета — 401', async () => {
    const app = createApp(createTestDeps());
    for (const method of ['GET', 'POST']) {
      const res = await app.request('/api/cron/tick', { method });
      expect(res.status).toBe(401);
      expect(ApiError.parse(await res.json()).error.code).toBe('cron_unauthorized');
    }
    const wrong = await app.request('/api/cron/tick', {
      headers: { authorization: 'Bearer wrong' },
    });
    expect(wrong.status).toBe(401);
  });

  it('с секретом и без задач — пустой ответ', async () => {
    const res = await createApp(createTestDeps()).request('/api/cron/tick', { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ran: [], skipped: [] });
  });

  it('в реестре есть очистка журнала запусков, счёта неверных паролей, частоты выгрузок, брошенных загрузок и создание отчётов', () => {
    expect(jobs.map((j) => j.name)).toEqual(
      expect.arrayContaining([
        'system.cleanup-scheduler-runs',
        'auth.cleanup-login-attempts',
        'system.cleanup-rate-limits',
        'contractors.sync-service-status',
        'reports.create-due',
        'files.cleanup-pending',
        'files.sent-purge',
      ]),
    );
  });

  it('у каждой задачи есть название для оповещений администратору платформы (alert.job.*)', () => {
    const all = jobsFor({
      APP_BASE_URL: 'https://test.buhuchet.kg',
      TELEGRAM_BOT_TOKEN: '123456789:test-token-not-real-0000000000000',
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-0000',
    });
    const missing = all
      .map((j) => `alert.job.${j.name.replace(/[.-]/g, '_')}`)
      .filter((key) => !(key in UI_TEXTS));
    expect(missing).toEqual([]);
  });

  it('вебхук бота сайт сообщает сам — только если бот задан и адрес сайта по https', async () => {
    const bot = {
      TELEGRAM_BOT_TOKEN: '123456789:test-token-not-real-0000000000000',
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-0000',
    };
    const names = (list: readonly Job[]) => list.map((j) => j.name);
    // Напоминания и очередь отправки в Telegram (задача 2.25) — всегда: без бота они ничего не делают.
    // Подписки, память и сверка хранилища (пакет 20.11.2026, поток Т, этап 1, П13) — тоже всегда.
    // Срок API-токенов «Витрины данных» (общий план 20.11, этап 3, П5) — тоже.
    const telegramJobs = [
      'telegram.reminders',
      'telegram.send',
      'subs.reminders',
      'subs.memory-checks',
      'files.storage-reconcile',
      'dm.token-expiry',
    ];
    expect(names(jobsFor({ APP_BASE_URL: 'https://test.buhuchet.kg' }))).toEqual([
      ...names(jobs),
      ...telegramJobs,
    ]);
    expect(names(jobsFor({ APP_BASE_URL: 'http://localhost:3000', ...bot }))).toEqual([
      ...names(jobs),
      ...telegramJobs,
    ]);
    const withBot = jobsFor({ APP_BASE_URL: 'https://test.buhuchet.kg/', ...bot });
    expect(names(withBot)).toEqual([...names(jobs), ...telegramJobs, 'telegram.register-webhook']);

    const telegram = createFakeTelegram();
    // Меню команд бота задача читает из шаблонов: у базы без своих шаблонов — подписи по умолчанию.
    const db = { select: () => ({ from: async () => [] }) } as unknown as ApiDeps['db'];
    await withBot.at(-1)!.run(createTestDeps({ telegram, db }), new Date());
    expect(telegram.commands?.map((c) => c.command)).toEqual([
      'today',
      'week',
      'overdue',
      'find',
      'myweek',
    ]);
    expect(telegram.webhook).toEqual({
      url: 'https://test.buhuchet.kg/api/telegram/webhook',
      secretToken: 'webhook-secret-0000',
    });
    // Без бота задача ничего не делает.
    const job = telegramWebhookJob({
      url: 'https://x.example/api/telegram/webhook',
      secretToken: 's',
    });
    await expect(job.run(createTestDeps({ telegram: null }), new Date())).resolves.toBeUndefined();
  });
});

describe.skipIf(!databaseAvailable())('/api/cron/tick с базой', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase();
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('выполняет слот один раз, даже если вызвать дважды или одновременно', async () => {
    const run = vi.fn(async () => {});
    const job: Job = { name: 'test.daily', cron: '0 9 * * *', lookbackMinutes: 120, run };
    const clock = fixedClock('2026-10-18T03:20:00Z'); // 09:20 по Бишкеку
    // Свой пул из нескольких соединений: на пуле из одного вызовы шли бы по очереди, без гонки.
    const race = createRaceApp(t.appUrl, createTestDeps({ db: t.app.db, clock, jobs: [job] }));
    onTestFinished(() => race.close());
    const app = race.app;

    const [a, b] = await Promise.all([
      app.request('/api/cron/tick', { headers: auth }),
      app.request('/api/cron/tick', { method: 'POST', headers: auth }),
    ]);
    const bodies = [CronTickResponse.parse(await a.json()), CronTickResponse.parse(await b.json())];
    expect(run).toHaveBeenCalledTimes(1);
    expect(bodies.flatMap((x) => x.ran)).toEqual([
      { job: 'test.daily', slot: '2026-10-18T03:00:00.000Z', ok: true },
    ]);
    expect(bodies.flatMap((x) => x.skipped)).toEqual(['test.daily']);

    clock.set('2026-10-19T03:00:30Z');
    const next = CronTickResponse.parse(
      await (await app.request('/api/cron/tick', { headers: auth })).json(),
    );
    expect(next.ran).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('упавшая задача записывается с ошибкой и не мешает остальным', async () => {
    const failing: Job = {
      name: 'test.failing',
      cron: '* * * * *',
      run: async () => {
        throw new Error('сломалось');
      },
    };
    const weird: Job = {
      name: 'test.weird',
      cron: '* * * * *',
      run: () => Promise.reject('не Error'),
    };
    const okRun = vi.fn(async () => {});
    const ok: Job = { name: 'test.ok', cron: '* * * * *', run: okRun };
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const logger = createLogger({
      level: 'info',
      environment: 'test',
      version: 'test',
      service: 'web',
      destination,
    });
    const deps = createTestDeps({
      db: t.app.db,
      clock: fixedClock('2026-10-18T05:00:00Z'),
      jobs: [failing, weird, ok],
      logger,
    });
    const body = CronTickResponse.parse(
      await (await createApp(deps).request('/api/cron/tick', { headers: auth })).json(),
    );
    expect(body.ran).toEqual([
      { job: 'test.failing', slot: '2026-10-18T05:00:00.000Z', ok: false },
      { job: 'test.weird', slot: '2026-10-18T05:00:00.000Z', ok: false },
      { job: 'test.ok', slot: '2026-10-18T05:00:00.000Z', ok: true },
    ]);
    const rows = await t.admin.db.select().from(schema.schedulerRuns);
    expect(rows.find((r) => r.job === 'test.failing')?.error).toBe('сломалось');
    expect(rows.find((r) => r.job === 'test.weird')?.error).toBe('не Error');
    const done = lines
      .map((l) => JSON.parse(l) as { msg: string; job?: string })
      .filter((e) => e.msg === 'задача по расписанию выполнена');
    expect(done.map((e) => e.job)).toEqual(['test.ok']);
  });

  it('очистка удаляет запуски старше 30 дней, полученные ботом сообщения и журнал «Витрины» старше 90', async () => {
    await t.admin.db.insert(schema.schedulerRuns).values([
      { job: 'old', slot: new Date('2026-09-01T00:00:00Z') },
      { job: 'fresh', slot: new Date('2026-10-10T00:00:00Z') },
    ]);
    // Та же задача чистит полученные ботом сообщения: они хранятся 90 дней (часы теста — 18.10.2026).
    const inboxRow = (text: string, at: string) => ({
      chatId: 1,
      chatKind: 'private' as const,
      kind: 'text' as const,
      text,
      createdAt: new Date(at),
    });
    await t.admin.db
      .insert(schema.telegramInbox)
      .values([
        inboxRow('старше 90 дней', '2026-07-19T00:00:00Z'),
        inboxRow('моложе 90 дней', '2026-07-21T00:00:00Z'),
      ]);
    // Журнал запросов «Витрины данных» — тоже 90 дней, по часам базы (доработки 20.11.2026: Витрина
    // данных, блок 6, пункт 7; поток Т, этап 2, П11).
    const [tpl] = await t.admin.db
      .insert(schema.dmTemplates)
      .values({ code: 'cron-clean', name: 'Очистка', audience: 'admin', state: 'published' })
      .returning({ id: schema.dmTemplates.id });
    await t.admin.db.insert(schema.dmRequests).values(
      [91, 89].map((days) => ({
        templateId: tpl!.id,
        via: 'screen' as const,
        outcome: 'ok' as const,
        rowCount: days,
        at: sql`now() - make_interval(days => ${days})`,
      })),
    );
    const deps = createTestDeps({ db: t.app.db });
    const removed = await cleanupSchedulerRuns.run(deps, deps.clock.now());
    const requests = await t.admin.db.select().from(schema.dmRequests);
    expect(requests.map((r) => r.rowCount)).toEqual([89]);
    const left = (await t.admin.db.select().from(schema.schedulerRuns)).map((r) => r.job);
    expect(left).not.toContain('old');
    expect(left).toContain('fresh');
    const inbox = (await t.admin.db.select().from(schema.telegramInbox)).map((r) => r.text);
    expect(inbox).toEqual(['моложе 90 дней']);
    // Итог задачи — сколько строк удалено из всех журналов («Что сделано» в Админке → «Запуски»).
    expect(removed).toBeGreaterThanOrEqual(3);
    await t.admin.db.delete(schema.telegramInbox);
    await t.admin.db.delete(schema.dmRequests);
    await t.admin.db.delete(schema.dmTemplates);
  });

  it('очистка счёта неверных паролей: удаляются забытые строки, закрытый вход остаётся', async () => {
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
    await t.admin.db.insert(schema.loginAttempts).values([
      { login: 'forgotten', failures: 3, lastAttemptAt: minutesAgo(61) },
      { login: 'recent', failures: 2, lastAttemptAt: minutesAgo(59) },
      {
        login: 'still-locked',
        failures: 0,
        lockedUntil: new Date(Date.now() + 600_000),
        lastAttemptAt: minutesAgo(61),
      },
    ]);
    await cleanupLoginAttemptsJob.run(createTestDeps({ db: t.app.db }), new Date());
    const left = (await t.admin.db.select().from(schema.loginAttempts)).map((r) => r.login);
    expect(left.sort()).toEqual(['recent', 'still-locked']);
  });

  it('очистка частоты выгрузок: строки старше суток удаляются, свежие остаются', async () => {
    await t.admin.db.insert(schema.rateLimits).values([
      { kind: 'export', subject: 'old', at: new Date(Date.now() - 25 * 3600_000) },
      { kind: 'export', subject: 'fresh' },
    ]);
    await cleanupRateLimitsJob.run(createTestDeps({ db: t.app.db }), new Date());
    const left = (await t.admin.db.select().from(schema.rateLimits)).map((r) => r.subject);
    expect(left).toEqual(['fresh']);
  });
});
