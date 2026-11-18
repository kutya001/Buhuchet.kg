import type { ListQuery } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  exportRuns,
  jobRunFacts,
  listJobsPage,
  listJobValues,
  listRunsPage,
  listRunValues,
  runWithAttempts,
  type JobListRow,
  type RunTexts,
} from './admin-runs';
import { claimJobSlot, finishJobRun } from './scheduler';
import { schedulerRuns } from './schema';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  sort: undefined,
  page: 1,
  size: 25,
  filters: {},
  ...over,
});

const TEXTS: RunTexts = {
  status: { ok: 'Успешно', error: 'Ошибка', running: 'Выполняется' },
  attempt: '{n} из 3',
  nothing: 'Нечего делать',
  seconds: '{s} с',
  minutes: '{m} мин {s} с',
};
const JOBS = [
  {
    name: 'telegram.send',
    title: 'Отправка сообщений Telegram',
    done: 'Отправлено сообщений: {n}',
  },
  { name: 'files.storage-retry', title: 'Повторное удаление файлов', done: 'Сделано: {n}' },
];
const SLOT = new Date('2026-11-07T04:00:00Z');
const at = (min: number, sec = 0) => new Date(SLOT.getTime() + min * 60_000 + sec * 1000);
const FROM = new Date('2026-11-01T00:00:00Z');
const retry = { maxAttempts: 3, retryDelaysMinutes: [2, 10] };

describe.skipIf(!databaseAvailable())('Админка → «Запуски» (прототип v132)', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase();
    const db = t.app.db;
    // Задача с тремя попытками: две неудачи и успех; прежние попытки остаются в строке запуска.
    const run = async (startMin: number, error: string | null, done?: number) => {
      const n = await claimJobSlot(db, {
        job: 'files.storage-retry',
        slot: SLOT,
        now: at(startMin),
        ...retry,
      });
      await finishJobRun(db, {
        job: 'files.storage-retry',
        slot: SLOT,
        attempt: n!,
        now: at(startMin, 3),
        error,
        done,
      });
    };
    await run(0, 'S3: timeout');
    // Повтор — через 2 минуты после конца первой попытки и через 10 после конца второй.
    await run(4, 'S3: 503');
    await run(15, null, 2);
    // Пустой успешный запуск, запуск с работой и запуск, который ещё идёт.
    for (const [min, done] of [
      [1, 0],
      [3, 5],
    ] as const) {
      const slot = at(min);
      await claimJobSlot(db, { job: 'telegram.send', slot, now: slot, ...retry });
      await finishJobRun(db, {
        job: 'telegram.send',
        slot,
        attempt: 1,
        now: new Date(slot.getTime() + 61_000),
        error: null,
        done,
      });
    }
    await claimJobSlot(db, { job: 'telegram.send', slot: at(20), now: at(20), ...retry });
  });

  afterAll(async () => {
    await t?.drop();
  });

  const tx = <T>(fn: Parameters<TestDatabase['app']['db']['transaction']>[0]) =>
    t.app.db.transaction(fn) as Promise<T>;

  it('повтор запуска сохраняет прежнюю попытку, итог пишет «что сделано» только у успеха', async () => {
    const run = await runWithAttempts(t.app.db, 'files.storage-retry', SLOT);
    expect(run!.last).toMatchObject({ attempt: 3, status: 'ok', error: null, done: 2 });
    expect(run!.prev).toEqual([
      {
        attempt: 1,
        startedAt: at(0).toISOString(),
        finishedAt: at(0, 3).toISOString(),
        error: 'S3: timeout',
      },
      {
        attempt: 2,
        startedAt: at(4).toISOString(),
        finishedAt: at(4, 3).toISOString(),
        error: 'S3: 503',
      },
    ]);
    expect(await runWithAttempts(t.app.db, 'no.such', SLOT)).toBeNull();
    // Число у неудачи не пишется: упавшая попытка не «сделала» ничего.
    const slot = at(40);
    await claimJobSlot(t.app.db, { job: 'x.fail', slot, now: slot, ...retry });
    await finishJobRun(t.app.db, {
      job: 'x.fail',
      slot,
      attempt: 1,
      now: slot,
      error: 'e',
      done: 9,
    });
    const [row] = await t.admin.db
      .select({ done: schedulerRuns.done })
      .from(schedulerRuns)
      .where(sql`${schedulerRuns.job} = 'x.fail'`);
    expect(row!.done).toBeNull();
    await t.admin.db.delete(schedulerRuns).where(sql`${schedulerRuns.job} = 'x.fail'`);
  });

  it('журнал: каждая попытка — строка; «Важные» скрывают пустые успешные; подписи, поиск, фильтр, выгрузка', async () => {
    const o = { jobs: JOBS, texts: TEXTS };
    const all = await tx<Awaited<ReturnType<typeof listRunsPage>>>((x) =>
      listRunsPage(x, { ...o, query: query(), scope: { from: FROM, important: false } }),
    );
    expect(all.total).toBe(6);
    expect(all.rows.map((r) => [r.job, r.attempt, r.status, r.done])).toEqual([
      ['telegram.send', 1, 'running', null],
      ['files.storage-retry', 3, 'ok', 2],
      ['files.storage-retry', 2, 'error', null],
      ['telegram.send', 1, 'ok', 5],
      ['telegram.send', 1, 'ok', 0],
      ['files.storage-retry', 1, 'error', null],
    ]);
    const important = await tx<Awaited<ReturnType<typeof listRunsPage>>>((x) =>
      listRunsPage(x, { ...o, query: query(), scope: { from: FROM, important: true } }),
    );
    expect(important.total).toBe(5);
    expect(important.rows.some((r) => r.status === 'ok' && r.done === 0)).toBe(false);
    // Период: запуски раньше границы не показываются.
    const late = await tx<Awaited<ReturnType<typeof listRunsPage>>>((x) =>
      listRunsPage(x, { ...o, query: query(), scope: { from: at(10), important: false } }),
    );
    expect(late.rows.map((r) => r.attempt)).toEqual([1, 3]);
    const errors = await tx<Awaited<ReturnType<typeof listRunsPage>>>((x) =>
      listRunsPage(x, {
        ...o,
        query: query({ filters: { st: { type: 'enum', vals: ['error'] } } }),
        scope: { from: FROM, important: true },
      }),
    );
    expect(errors.rows.map((r) => r.error)).toEqual(['S3: 503', 'S3: timeout']);
    const found = await tx<Awaited<ReturnType<typeof listRunsPage>>>((x) =>
      listRunsPage(x, {
        ...o,
        query: query({ search: { q: 'отправлено сообщений: 5', keys: ['title', 'done'] } }),
        scope: { from: FROM, important: false },
      }),
    );
    expect(found.rows).toHaveLength(1);
    const titles = await tx<Awaited<ReturnType<typeof listRunValues>>>((x) =>
      listRunValues(x, { ...o, key: 'title', scope: { from: FROM, important: false } }),
    );
    expect(titles.items).toEqual(
      expect.arrayContaining([
        { value: 'telegram.send', label: 'Отправка сообщений Telegram', count: 3 },
        { value: 'files.storage-retry', label: 'Повторное удаление файлов', count: 3 },
      ]),
    );
    const file = await tx<Awaited<ReturnType<typeof exportRuns>>>((x) =>
      exportRuns(x, {
        ...o,
        query: query({ sort: { key: 'start', dir: 'asc' } }),
        keys: ['title', 'st', 'dur', 'tr', 'done', 'err'],
        scope: { from: FROM, important: false },
      }),
    );
    expect(file.rows.slice(0, 3)).toEqual([
      ['Повторное удаление файлов', 'Ошибка', '3 с', '1 из 3', null, 'S3: timeout'],
      ['Отправка сообщений Telegram', 'Успешно', '1 мин 1 с', '1 из 3', 'Нечего делать', null],
      [
        'Отправка сообщений Telegram',
        'Успешно',
        '1 мин 1 с',
        '1 из 3',
        'Отправлено сообщений: 5',
        null,
      ],
    ]);
    // «Длительность» и «Что сделано» уходят в Excel текстом, как на экране (в прототипе столбцы текстовые).
    expect(file.rows[4]![4]).toBe('Сделано: 2');
  });

  it('последний запуск, последний успех и ошибки за период — по всем попыткам', async () => {
    const facts = await jobRunFacts(
      t.app.db,
      ['files.storage-retry', 'telegram.send', 'never.ran'],
      FROM,
    );
    expect(facts.get('files.storage-retry')).toEqual({
      lastAt: at(15),
      lastStatus: 'ok',
      okAt: at(15),
      errors: 2,
    });
    expect(facts.get('telegram.send')).toEqual({
      lastAt: at(20),
      lastStatus: 'running',
      okAt: at(3),
      errors: 0,
    });
    expect(facts.get('never.ran')).toEqual({
      lastAt: null,
      lastStatus: null,
      okAt: null,
      errors: 0,
    });
    // Ошибки раньше границы периода в счёт не идут.
    const later = await jobRunFacts(t.app.db, ['files.storage-retry'], at(1));
    expect(later.get('files.storage-retry')!.errors).toBe(1);
  });

  it('список задач: сначала «Падает», поиск и фильтр по состоянию', async () => {
    const rows: JobListRow[] = [
      {
        name: 'telegram.send',
        title: 'Отправка сообщений Telegram',
        every: 'Каждую минуту',
        everyMin: 1,
        what: 'Отправляет очередь',
        lastAt: at(20).toISOString(),
        lastStatus: 'running',
        lastStatusText: 'Выполняется',
        okAt: at(3).toISOString(),
        fails: 0,
        state: 'ok',
        stateText: 'Работает',
        stateRank: 2,
      },
      {
        name: 'files.storage-retry',
        title: 'Повторное удаление файлов',
        every: 'Каждый час в :40',
        everyMin: 60,
        what: 'Повторяет удаление',
        lastAt: null,
        lastStatus: null,
        lastStatusText: '',
        okAt: null,
        fails: 3,
        state: 'failing',
        stateText: 'Падает',
        stateRank: 0,
      },
    ];
    const page = await tx<Awaited<ReturnType<typeof listJobsPage>>>((x) =>
      listJobsPage(x, rows, query()),
    );
    expect(page.rows.map((r) => [r.name, r.state, r.fails])).toEqual([
      ['files.storage-retry', 'failing', 3],
      ['telegram.send', 'ok', 0],
    ]);
    expect(page.rows[1]!.lastAt).toEqual(at(20));
    expect(page.rows[0]!.lastAt).toBeNull();
    const failing = await tx<Awaited<ReturnType<typeof listJobsPage>>>((x) =>
      listJobsPage(x, rows, query({ filters: { st: { type: 'enum', vals: ['failing'] } } })),
    );
    expect(failing.rows.map((r) => r.name)).toEqual(['files.storage-retry']);
    const found = await tx<Awaited<ReturnType<typeof listJobsPage>>>((x) =>
      listJobsPage(x, rows, query({ search: { q: 'очередь', keys: ['title', 'what'] } })),
    );
    expect(found.rows.map((r) => r.name)).toEqual(['telegram.send']);
    const states = await tx<Awaited<ReturnType<typeof listJobValues>>>((x) =>
      listJobValues(x, rows, 'st'),
    );
    expect(states.items).toEqual(
      expect.arrayContaining([
        { value: 'failing', label: 'Падает', count: 1 },
        { value: 'ok', label: 'Работает', count: 1 },
      ]),
    );
  });
});
