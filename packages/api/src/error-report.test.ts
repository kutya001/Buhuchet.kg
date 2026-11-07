import type { ErrorReporter } from '@buhuchet/adapters';
import type { Db } from '@buhuchet/db';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { createTestDeps } from './testing';

/** База-подделка: любой запрос находит сеанс администратора платформы (как в app.test.ts). */
const signedInDb = {
  execute: async () => [
    {
      session_id: '0b2d4e6f-0000-4000-8003-000000000001',
      user_id: '0b2d4e6f-0000-4000-8002-000000000001',
      org_id: null,
      login: 'platform-admin',
      is_platform_admin: true,
      must_change_password: false,
      user_blocked: false,
      employee_id: null,
      employee_active: null,
      org_status: null,
      org_name: null,
      touched: false,
    },
  ],
} as unknown as Db;
const signedIn = { cookie: `bh_session=${'A'.repeat(43)}`, origin: 'http://localhost' };

describe('ошибки сервера — в Sentry (ревью безопасности Р-8)', () => {
  it('непредвиденная ошибка: 500 наружу, в Sentry — ошибка, метод и путь без строки запроса', async () => {
    const capture = vi.fn<ErrorReporter['capture']>(async () => {});
    const app = createApp(createTestDeps({ db: signedInDb, errors: { capture } }));
    const err = new Error('сломалось');
    app.get('/boom', () => {
      throw err;
    });
    const res = await app.request('/api/boom?q=иванов', { headers: signedIn });
    expect(res.status).toBe(500);
    expect(capture).toHaveBeenCalledWith(err, {
      method: 'GET',
      path: '/api/boom',
      requestId: expect.any(String),
    });
  });

  it('ожидаемые ответы (404, 409, 503 по пределу времени) в Sentry не уходят', async () => {
    const capture = vi.fn<ErrorReporter['capture']>(async () => {});
    const app = createApp(createTestDeps({ db: signedInDb, errors: { capture } }));
    app.get('/slow', () => {
      throw Object.assign(new Error('Failed query: select …'), {
        cause: Object.assign(new Error('canceling statement due to statement timeout'), {
          code: '57014',
        }),
      });
    });
    expect((await app.request('/api/slow', { headers: signedIn })).status).toBe(503);
    expect((await app.request('/api/nope', { headers: signedIn })).status).toBe(404);
    expect(capture).not.toHaveBeenCalled();
  });
});
