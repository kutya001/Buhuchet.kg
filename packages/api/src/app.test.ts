import { RecordChangedError, RecordNotFoundError } from '@buhuchet/domain';
import { ApiError, HealthResponse, isRecordChanged } from '@buhuchet/shared';
import type { Db } from '@buhuchet/db';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { versionedSaveResponses } from './errors';
import { createTestDeps } from './testing';

const okDb = { execute: async () => [] } as unknown as Db;

/**
 * База-подделка, где любой запрос находит сеанс администратора платформы: так общий обработчик
 * ошибок проверяется за слоем входа без PostgreSQL. Вход и права — в auth.test.ts против базы.
 */
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
const signedInApp = () => createApp(createTestDeps({ db: signedInDb }));

describe('GET /api/health', () => {
  it('200 и «ok», когда база и хранилище доступны', async () => {
    const app = createApp(createTestDeps({ db: okDb }));
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const body = HealthResponse.parse(await res.json());
    expect(body).toMatchObject({
      status: 'ok',
      environment: 'test',
      todayBishkek: '2026-10-18',
      checks: { database: 'ok', storage: 'ok' },
    });
  });

  it('503 и «degraded», когда база недоступна', async () => {
    const app = createApp(createTestDeps());
    const res = await app.request('/api/health');
    expect(res.status).toBe(503);
    expect(HealthResponse.parse(await res.json()).checks).toEqual({
      database: 'error',
      storage: 'ok',
    });
  });

  it('503, когда хранилище недоступно', async () => {
    const deps = createTestDeps({ db: okDb });
    deps.storage.ping = async () => {
      throw new Error('нет корзины');
    };
    const res = await createApp(deps).request('/api/health');
    expect(res.status).toBe(503);
    expect(HealthResponse.parse(await res.json()).checks.storage).toBe('error');
  });
});

describe('служебное', () => {
  it('описание OpenAPI строится из схем', async () => {
    const res = await createApp(createTestDeps()).request('/api/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/health',
        '/api/cron/tick',
        '/api/auth/login',
        '/api/auth/logout',
        '/api/auth/me',
        '/api/auth/password',
        '/api/auth/password-reset',
        '/api/auth/password-reset/confirm',
        '/api/telegram/link',
        '/api/telegram/webhook',
        '/api/staff',
        '/api/staff/{id}',
        '/api/staff/{id}/block',
        '/api/staff/{id}/unblock',
        '/api/staff/{id}/password-reset',
        '/api/roles',
        '/api/roles/values',
        '/api/roles/export',
        '/api/roles/{id}',
        '/api/permissions',
        '/api/phone-codes',
        '/api/admin/users/{id}/password-reset',
      ]),
    );
  });

  it('без входа любой метод, кроме открытых, — 401 в общем формате ошибки', async () => {
    const res = await createApp(createTestDeps()).request('/api/nope');
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      error: { code: 'unauthorized', message: 'Войдите в систему' },
    });
  });

  it('неизвестный метод — 404 в общем формате ошибки', async () => {
    const res = await signedInApp().request('/api/nope', { headers: signedIn });
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Метод не найден' } });
  });

  it('непредвиденная ошибка — 500 без подробностей наружу', async () => {
    const app = signedInApp();
    app.get('/boom', () => {
      throw new Error('секретная подробность');
    });
    const res = await app.request('/api/boom', { headers: signedIn });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('секретная');
  });

  it('запрос к базе дольше предела — 503 query_timeout, а не «Внутренняя ошибка»', async () => {
    const app = signedInApp();
    app.get('/slow', () => {
      // Так ошибку отдаёт drizzle: ошибка PostgreSQL 57014 — в причине.
      throw Object.assign(new Error('Failed query: select …'), {
        cause: Object.assign(new Error('canceling statement due to statement timeout'), {
          code: '57014',
        }),
      });
    });
    const res = await app.request('/api/slow', { headers: signedIn });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: 'query_timeout', message: 'Запрос выполнялся слишком долго' },
    });
  });

  it('неверные данные запроса — 400 validation_failed с подробностями', async () => {
    const { createRoute, z } = await import('@hono/zod-openapi');
    const app = signedInApp();
    app.openapi(
      createRoute({
        method: 'get',
        path: '/echo',
        request: { query: z.object({ n: z.coerce.number().int() }) },
        responses: {
          200: {
            description: 'ok',
            content: { 'application/json': { schema: z.object({ n: z.number() }) } },
          },
        },
      }),
      (c) => c.json({ n: c.req.valid('query').n }, 200),
    );
    expect(await (await app.request('/api/echo?n=5', { headers: signedIn })).json()).toEqual({
      n: 5,
    });
    const bad = await app.request('/api/echo?n=пять', { headers: signedIn });
    expect(bad.status).toBe(400);
    const body = ApiError.parse(await bad.json());
    expect(body.error.code).toBe('validation_failed');
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it('HTTPException отдаёт свой статус', async () => {
    const { HTTPException } = await import('hono/http-exception');
    const app = signedInApp();
    app.get('/teapot', () => {
      throw new HTTPException(418, { message: 'чайник' });
    });
    const res = await app.request('/api/teapot', { headers: signedIn });
    expect(res.status).toBe(418);
    expect(ApiError.parse(await res.json()).error.code).toBe('http_error');
  });

  it('устаревшая версия записи — 409 record_changed «Запись изменена другим пользователем»', async () => {
    const app = signedInApp();
    app.put('/stale', () => {
      throw new RecordChangedError('employee', 'e3', 4);
    });
    const res = await app.request('/api/stale', { method: 'PUT', headers: signedIn });
    expect(res.status).toBe(409);
    const body = ApiError.parse(await res.json());
    expect(body).toEqual({
      error: {
        code: 'record_changed',
        message: 'Запись изменена другим пользователем',
        details: { version: 4 },
      },
    });
    expect(isRecordChanged(body)).toBe(true);
  });

  it('нет записи — 404 not_found без подробностей', async () => {
    const app = signedInApp();
    app.put('/missing', () => {
      throw new RecordNotFoundError('employee', 'e3');
    });
    const res = await app.request('/api/missing', { method: 'PUT', headers: signedIn });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'not_found', message: 'Запись не найдена' },
    });
  });

  it('метод с версией записи описывает в OpenAPI ответы 404 и 409', async () => {
    const { createRoute, z } = await import('@hono/zod-openapi');
    const app = createApp(createTestDeps());
    app.openapi(
      createRoute({
        method: 'put',
        path: '/versioned',
        responses: {
          200: {
            description: 'ok',
            content: { 'application/json': { schema: z.object({ version: z.number() }) } },
          },
          ...versionedSaveResponses,
        },
      }),
      (c) => c.json({ version: 2 }, 200),
    );
    const doc = (await (await app.request('/api/openapi.json')).json()) as {
      paths: Record<string, { put: { responses: Record<string, unknown> } }>;
    };
    expect(Object.keys(doc.paths['/api/versioned']!.put.responses)).toEqual(['200', '404', '409']);
  });
});
