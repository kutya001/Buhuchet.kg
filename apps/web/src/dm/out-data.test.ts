import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../api-client';
import { runOutQuery } from './out-data';

describe('«Вывод»: прежний запрос человека ещё идёт (блок 8, пункт 5)', () => {
  const retry = runOutQuery('org', { code: 'reports-due', params: {}, orgId: null, n: 1 }).retry;
  const busy = new ApiFailure(429, { code: 'dm_busy', message: 'busy' });
  const failure = (code: string, status = 400) => new ApiFailure(status, { code, message: code });

  it('429 `dm_busy` — запрос ждёт очереди: переспрашивает раз в полсекунды дольше предела в 15 с', () => {
    if (typeof retry !== 'function') throw new Error('retry — функция');
    expect(retry(0, busy)).toBe(true);
    expect(retry(39, busy)).toBe(true);
    expect(retry(40, busy)).toBe(false);
    // Заняты все места запуска сайта (п. О-96) — тоже очередь, а не ошибка на экране.
    const busyAll = new ApiFailure(429, { code: 'dm_busy_all', message: 'busy all' });
    expect(retry(0, busyAll)).toBe(true);
    expect(retry(40, busyAll)).toBe(false);
    expect(runOutQuery('admin', { code: 'orgs', params: {}, orgId: null, n: 0 }).retryDelay).toBe(
      500,
    );
  });

  it('остальные отказы — сразу на экран, без повтора', () => {
    if (typeof retry !== 'function') throw new Error('retry — функция');
    expect(retry(0, failure('dm_rate', 429))).toBe(false);
    expect(retry(0, failure('dm_timeout'))).toBe(false);
    expect(retry(0, failure('dm_template_broken', 409))).toBe(false);
    expect(retry(0, new Error('сеть'))).toBe(false);
  });
});
