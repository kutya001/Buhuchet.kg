import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../api-client';
import { retryBusy, runOutQuery } from './out-data';

describe('«Вывод»: прежний запрос человека ещё идёт (блок 8, пункт 5)', () => {
  const retry = runOutQuery('org', { code: 'reports-due', params: {}, orgId: null, n: 1 }).retry;
  const busy = new ApiFailure(429, { code: 'dm_busy', message: 'busy' });
  const failure = (code: string, status = 400) => new ApiFailure(status, { code, message: code });

  it('429 `dm_busy` — запрос ждёт очереди: переспрашивает раз в полсекунды дольше предела в 15 с', () => {
    if (typeof retry !== 'function') throw new Error('retry — функция');
    expect(retry(0, busy)).toBe(true);
    expect(retry(39, busy)).toBe(true);
    expect(retry(40, busy)).toBe(false);
    const delay = runOutQuery('admin', { code: 'orgs', params: {}, orgId: null, n: 0 }).retryDelay;
    if (typeof delay !== 'function') throw new Error('retryDelay — функция');
    expect(delay(1, busy)).toBe(500);
  });

  it('429 `dm_busy_all` (заняты места запуска сайта, п. О-96) — тоже очередь, но реже: 10 раз раз в 2 с', () => {
    if (typeof retry !== 'function') throw new Error('retry — функция');
    const busyAll = new ApiFailure(429, { code: 'dm_busy_all', message: 'busy all' });
    expect(retry(0, busyAll)).toBe(true);
    expect(retry(9, busyAll)).toBe(true);
    expect(retry(10, busyAll)).toBe(false);
    const delay = runOutQuery('org', {
      code: 'reports-due',
      params: {},
      orgId: null,
      n: 1,
    }).retryDelay;
    if (typeof delay !== 'function') throw new Error('retryDelay — функция');
    expect(delay(1, busyAll)).toBe(2_000);
  });

  it('остальные отказы — сразу на экран, без повтора', () => {
    if (typeof retry !== 'function') throw new Error('retry — функция');
    expect(retry(0, failure('dm_rate', 429))).toBe(false);
    expect(retry(0, failure('dm_timeout'))).toBe(false);
    expect(retry(0, failure('dm_template_broken', 409))).toBe(false);
    expect(retry(0, new Error('сеть'))).toBe(false);
  });
});

describe('«В Excel» «Вывода» ждёт очереди, как «Показать» (п. О-96)', () => {
  const answer = (status: number, code?: string) =>
    new Response(JSON.stringify(code ? { error: { code, message: code } } : {}), { status });

  it('429 `dm_busy_all` и `dm_busy` — переспрашивает (раз в 2 с и раз в 0,5 с), файл — с первого ответа не 429', async () => {
    const replies = [answer(429, 'dm_busy_all'), answer(429, 'dm_busy'), answer(200)];
    const waits: number[] = [];
    const res = await retryBusy(
      async () => replies.shift()!,
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(res.status).toBe(200);
    expect(waits).toEqual([2_000, 500]);
  });

  it('пул занят дольше 10 повторов — отказ уходит на экран; другие отказы — сразу', async () => {
    let sent = 0;
    const res = await retryBusy(
      async () => {
        sent += 1;
        return answer(429, 'dm_busy_all');
      },
      async () => {},
    );
    expect(res.status).toBe(429);
    expect(sent).toBe(11);
    // Тело отказа не потрачено: уведомление прочитает причину.
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('dm_busy_all');
    let other = 0;
    const limit = await retryBusy(
      async () => {
        other += 1;
        return answer(429, 'export_limit');
      },
      async () => {},
    );
    expect(limit.status).toBe(429);
    expect(other).toBe(1);
  });
});
