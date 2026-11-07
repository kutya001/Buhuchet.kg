import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  createSentryReporter,
  exceptionsOf,
  noopErrorReporter,
  parseSentryDsn,
  scrubText,
  stackFrames,
} from './error-reporter';
import { createLogger } from './logger';

const DSN = 'https://abc123public@o4500.ingest.de.sentry.io/4507001';

function memoryLogger() {
  const lines: Array<Record<string, unknown>> = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
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
  return { logger, lines };
}

describe('DSN Sentry', () => {
  it('адрес приёма событий и ключ — из DSN, в том числе своего сервера с путём', () => {
    expect(parseSentryDsn(DSN)).toEqual({
      envelopeUrl: 'https://o4500.ingest.de.sentry.io/api/4507001/envelope/',
      publicKey: 'abc123public',
      dsn: DSN,
    });
    expect(parseSentryDsn(' https://k@sentry.example.kg/errors/7 ')?.envelopeUrl).toBe(
      'https://sentry.example.kg/errors/api/7/envelope/',
    );
  });

  it('не DSN — null', () => {
    for (const bad of [
      '',
      'не адрес',
      'https://sentry.io/1',
      'https://k@sentry.io/',
      'ftp://k@h/1',
    ]) {
      expect(parseSentryDsn(bad)).toBeNull();
    }
  });
});

describe('что уходит в Sentry', () => {
  it('токен бота из адреса Bot API вычищается', () => {
    expect(
      scrubText(
        'fetch https://api.telegram.org/bot123456789:AAEhBP0av28_test-token-0000000/sendMessage',
      ),
    ).toBe('fetch https://api.telegram.org/bot[скрыто]/sendMessage');
  });

  it('кадры стека — от старых к новым, без первой строки с текстом ошибки', () => {
    const stack = [
      'Error: пароль=секрет',
      '    at run (/app/packages/api/src/jobs/runner.ts:10:5)',
      '    at async Promise.all (index 0)',
      '    at /app/node_modules/hono/dist/compose.js:35:11',
      '    at node:internal/process/task_queues:103:5',
    ].join('\n');
    const frames = stackFrames(stack);
    expect(frames).toEqual([
      { filename: 'node:internal/process/task_queues', lineno: 103, colno: 5, in_app: false },
      { filename: '/app/node_modules/hono/dist/compose.js', lineno: 35, colno: 11, in_app: false },
      {
        function: 'run',
        filename: '/app/packages/api/src/jobs/runner.ts',
        lineno: 10,
        colno: 5,
        in_app: true,
      },
    ]);
    expect(JSON.stringify(frames)).not.toContain('секрет');
    expect(stackFrames(undefined)).toEqual([]);
  });

  it('ошибка запроса к базе — без значений параметров; причины — по цепочке, внешняя последней', () => {
    const pg = Object.assign(new Error('duplicate key'), { code: '23505' });
    const query = Object.assign(new Error('Failed query: insert … params: +996555100200'), {
      query: 'insert into users values ($1)',
      params: ['+996555100200'],
      cause: pg,
    });
    const values = exceptionsOf(new Error('не сохранилось', { cause: query }));
    expect(values.map((v) => v.value)).toEqual(['Ошибка запроса к базе (23505)', 'не сохранилось']);
    expect(JSON.stringify(values)).not.toContain('+996555100200');
    expect(exceptionsOf('строка')).toEqual([{ type: 'Error', value: 'строка' }]);
    // Ошибка PostgreSQL без обёртки запроса — только код.
    const raw = Object.assign(new Error('invalid input syntax for type uuid: "01811201810456"'), {
      name: 'PostgresError',
      code: '22P02',
      severity: 'ERROR',
    });
    expect(exceptionsOf(raw).map((v) => v.value)).toEqual(['Ошибка базы (22P02)']);
  });
});

describe('createSentryReporter', () => {
  it('без DSN — ничего не отправляет', async () => {
    const { logger } = memoryLogger();
    const reporter = createSentryReporter({
      dsn: undefined,
      environment: 'production',
      release: '1',
      service: 'web',
      logger,
    });
    expect(reporter).toBe(noopErrorReporter);
    await expect(reporter.capture(new Error('x'))).resolves.toBeUndefined();
  });

  it('неверный DSN — предупреждение в журнал, сайт работает', () => {
    const { logger, lines } = memoryLogger();
    const reporter = createSentryReporter({
      dsn: 'abc',
      environment: 'production',
      release: '1',
      service: 'web',
      logger,
    });
    expect(reporter).toBe(noopErrorReporter);
    expect(lines.map((l) => l.msg)).toEqual([
      'SENTRY_DSN не похож на адрес Sentry: ошибки в Sentry не отправляются',
    ]);
  });

  it('событие — конверт Sentry: среда, версия, теги задачи и пути, без пустых значений', async () => {
    const { logger } = memoryLogger();
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}'));
    const reporter = createSentryReporter({
      dsn: DSN,
      environment: 'production',
      release: '2026.11.07',
      service: 'worker',
      logger,
      fetch,
      now: () => new Date('2026-11-07T10:00:00Z'),
    });
    await reporter.capture(new TypeError('сломалось'), {
      job: 'reports.create-due',
      attempt: 2,
      requestId: undefined,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://o4500.ingest.de.sentry.io/api/4507001/envelope/');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-sentry-auth']).toContain(
      'sentry_key=abc123public',
    );
    const [header, item, event] = String(init.body)
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(header).toMatchObject({ sent_at: '2026-11-07T10:00:00.000Z', dsn: DSN });
    expect(item).toEqual({ type: 'event' });
    expect(event).toMatchObject({
      level: 'error',
      platform: 'node',
      environment: 'production',
      release: '2026.11.07',
      timestamp: Date.parse('2026-11-07T10:00:00Z') / 1000,
      tags: { service: 'worker', job: 'reports.create-due' },
      extra: { attempt: 2 },
      exception: { values: [expect.objectContaining({ type: 'TypeError', value: 'сломалось' })] },
    });
    expect(header!.event_id).toBe(event!.event_id);
    expect(String(event!.event_id)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('Sentry не ответил или отказал — только предупреждение, вызывающий не падает', async () => {
    const { logger, lines } = memoryLogger();
    const failing = createSentryReporter({
      dsn: DSN,
      environment: 'production',
      release: '1',
      service: 'web',
      logger,
      fetch: () => Promise.reject(new Error('timeout')),
    });
    await expect(failing.capture(new Error('x'))).resolves.toBeUndefined();
    const refused = createSentryReporter({
      dsn: DSN,
      environment: 'production',
      release: '1',
      service: 'web',
      logger,
      fetch: async () => new Response('', { status: 429 }),
    });
    await refused.capture(new Error('x'));
    expect(lines.map((l) => l.msg)).toEqual([
      'ошибка не отправлена в Sentry',
      'Sentry не принял ошибку',
    ]);
  });
});
