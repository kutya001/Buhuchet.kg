import { databaseAvailable } from '@buhuchet/db/testing';
import { ApiError, ViewSettingsMap, ViewSettingsResponse } from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const SETTINGS = {
  hidden: ['phone'],
  shown: ['fullName', 'role'],
  order: ['role', 'fullName', 'phone'],
  widths: { fullName: 320 },
  sort: { key: 'fullName', dir: 'asc' },
  size: 50,
  density: 'compact',
};

describe.skipIf(!databaseAvailable())('Настройки вида списков: API', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;

  const call = (method: 'GET' | 'PUT' | 'DELETE', path: string, cookie?: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  const mine = async (cookie: string) => {
    const res = await call('GET', '/api/view-settings', cookie);
    expect(res.status).toBe(200);
    return ViewSettingsMap.parse(await res.json()).items;
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    chief = await signIn(f.app, 'chief-a', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('сохранить и прочитать свой вид; «Сбросить вид» удаляет его', async () => {
    expect(await mine(owner)).toEqual({});
    const saved = await call('PUT', '/api/view-settings/staff.list', owner, SETTINGS);
    expect(saved.status).toBe(200);
    expect(ViewSettingsResponse.parse(await saved.json())).toEqual({ settings: SETTINGS });
    expect(await mine(owner)).toEqual({ 'staff.list': SETTINGS });
    const replaced = await call('PUT', '/api/view-settings/staff.list', owner, { sort: null });
    expect(replaced.status).toBe(200);
    expect(await mine(owner)).toEqual({ 'staff.list': { sort: null } });
    const reset = await call('DELETE', '/api/view-settings/staff.list', owner);
    expect(await reset.json()).toEqual({ settings: null });
    expect(await mine(owner)).toEqual({});
  });

  it('вид у каждого свой: другой сотрудник и другая организация его не видят', async () => {
    await call('PUT', '/api/view-settings/staff.list', owner, { density: 'compact' });
    expect(await mine(chief)).toEqual({});
    expect(await mine(await signIn(f.app, 'acc-b', TEST_PASSWORD))).toEqual({});
    await call('DELETE', '/api/view-settings/staff.list', chief);
    expect(await mine(owner)).toEqual({ 'staff.list': { density: 'compact' } });
  });

  it('у администратора платформы — свои настройки', async () => {
    const admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    expect((await call('PUT', '/api/view-settings/staff.list', admin, { size: 100 })).status).toBe(
      200,
    );
    expect(await mine(admin)).toEqual({ 'staff.list': { size: 100 } });
    expect((await mine(owner))['staff.list']).not.toEqual({ size: 100 });
  });

  it('«Статистика» модуля запоминается у пользователя по модулю; чужого модуля нет', async () => {
    const saved = await call('PUT', '/api/view-settings/stats.reports', owner, { stats: false });
    expect(saved.status).toBe(200);
    expect((await mine(owner))['stats.reports']).toEqual({ stats: false });
    expect((await mine(chief))['stats.reports']).toBeUndefined();
    expect((await call('PUT', '/api/view-settings/stats.nope', owner, {})).status).toBe(404);
    await call('DELETE', '/api/view-settings/stats.reports', owner);
  });

  it('неизвестный список — 404; неверные настройки — 400; без входа — 401', async () => {
    const unknown = await call('PUT', '/api/view-settings/reports.nope', owner, {});
    expect(unknown.status).toBe(404);
    expect(ApiError.parse(await unknown.json()).error.code).toBe('not_found');
    expect((await call('DELETE', '/api/view-settings/x.y', owner)).status).toBe(404);
    expect((await call('PUT', '/api/view-settings/staff', owner, {})).status).toBe(400);
    for (const bad of [
      { widths: { fullName: 10 } },
      { hidden: ['<b>'] },
      { size: 7 },
      { sort: { key: 'fullName', dir: 'up' } },
      { view: 'tiles' },
      { group: ['a', 'b', 'c'] },
      { stats: 'yes' },
    ]) {
      const res = await call('PUT', '/api/view-settings/staff.list', owner, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await call('GET', '/api/view-settings')).status).toBe(401);
  });

  it('изменение вида — только с адреса самого сайта (Origin)', async () => {
    const res = await f.app.request('/api/view-settings/staff.list', {
      method: 'PUT',
      headers: {
        origin: 'https://evil.example',
        cookie: owner,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ size: 25 }),
    });
    expect(res.status).toBe(403);
  });
});
