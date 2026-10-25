import { ApiError, HealthResponse } from '@buhuchet/shared';
import type { Db } from '@buhuchet/db';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createTestDeps } from './testing';

const okDb = { execute: async () => [] } as unknown as Db;

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
      expect.arrayContaining(['/api/health', '/api/cron/tick']),
    );
  });

  it('неизвестный метод — 404 в общем формате ошибки', async () => {
    const res = await createApp(createTestDeps()).request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Метод не найден' } });
  });

  it('непредвиденная ошибка — 500 без подробностей наружу', async () => {
    const app = createApp(createTestDeps());
    app.get('/boom', () => {
      throw new Error('секретная подробность');
    });
    const res = await app.request('/api/boom');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('секретная');
  });

  it('неверные данные запроса — 400 validation_failed с подробностями', async () => {
    const { createRoute, z } = await import('@hono/zod-openapi');
    const app = createApp(createTestDeps());
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
    expect(await (await app.request('/api/echo?n=5')).json()).toEqual({ n: 5 });
    const bad = await app.request('/api/echo?n=пять');
    expect(bad.status).toBe(400);
    const body = ApiError.parse(await bad.json());
    expect(body.error.code).toBe('validation_failed');
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it('HTTPException отдаёт свой статус', async () => {
    const { HTTPException } = await import('hono/http-exception');
    const app = createApp(createTestDeps());
    app.get('/teapot', () => {
      throw new HTTPException(418, { message: 'чайник' });
    });
    const res = await app.request('/api/teapot');
    expect(res.status).toBe(418);
    expect(ApiError.parse(await res.json()).error.code).toBe('http_error');
  });
});
